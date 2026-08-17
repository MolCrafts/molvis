"""Step-runner for ``%%mv.demo`` cells (AST top-level statements).

Used by the Pyodide notebook host and any other controller that wants
statement-at-a-time execution with inter-step delays. The runner does
**not** know about cameras or frames — it only evals statements and
awaits awaitables (including JS Promises from an in-process RPC).

Between statements / loop iterations it checks
:mod:`molvis.interrupt` so the host Interrupt button can stop a demo
without SIGINT into the webloop.
"""

from __future__ import annotations

import ast
import asyncio
import inspect
import sys
from typing import Any, Callable, Mapping, MutableMapping

from .interrupt import check as check_interrupt

__all__ = [
    "run_demo",
    "is_awaitable",
    "default_namespace",
    "strip_demo_magic",
    "demo_cell_transform",
]

_STEP_HELPER = "__mv_demo_iteration_step__"


class _LoopPacer(ast.NodeTransformer):
    """Add an awaitable beat to every loop iteration in a demo cell."""

    @staticmethod
    def _beat(template: ast.stmt) -> ast.Expr:
        beat = ast.Expr(
            value=ast.Await(
                value=ast.Call(
                    func=ast.Name(id=_STEP_HELPER, ctx=ast.Load()),
                    args=[],
                    keywords=[],
                )
            )
        )
        return ast.copy_location(beat, template)

    def visit_For(self, node: ast.For) -> ast.For:
        self.generic_visit(node)
        node.body.append(self._beat(node.body[-1] if node.body else node))
        return node

    def visit_AsyncFor(self, node: ast.AsyncFor) -> ast.AsyncFor:
        self.generic_visit(node)
        node.body.append(self._beat(node.body[-1] if node.body else node))
        return node

    def visit_While(self, node: ast.While) -> ast.While:
        self.generic_visit(node)
        node.body.append(self._beat(node.body[-1] if node.body else node))
        return node


def is_awaitable(value: Any) -> bool:
    if inspect.isawaitable(value):
        return True
    return callable(getattr(value, "then", None))


async def _maybe_await(value: Any) -> Any:
    if value is None:
        return None
    if is_awaitable(value):
        return await value
    return value


def strip_demo_magic(source: str) -> tuple[str, float | None]:
    """Strip ``%%mv.demo`` and return ``(body, delay)``.

    ``delay`` is seconds to wait between steps. It is ``None`` when the
    magic line is absent (caller should run the cell normally).
    """
    if source is None:
        return "", None
    # Normalize newlines; keep body intact otherwise.
    text = source.replace("\r\n", "\n").replace("\r", "\n")
    if not text.lstrip().startswith("%%mv.demo"):
        return text, None
    # Magic must be the first non-empty line.
    lines = text.split("\n")
    first_idx = 0
    while first_idx < len(lines) and lines[first_idx].strip() == "":
        first_idx += 1
    if first_idx >= len(lines) or not lines[first_idx].strip().startswith("%%mv.demo"):
        return text, None
    magic = lines[first_idx].strip()
    delay = 0.2
    # %%mv.demo delay=0.2
    rest = magic[len("%%mv.demo") :].strip()
    if rest:
        if rest.startswith("delay="):
            delay = float(rest[len("delay=") :].split()[0])
        else:
            raise ValueError(
                "%%mv.demo expects delay=<seconds>, for example "
                "%%mv.demo delay=0.2"
            )
    body = "\n".join(lines[first_idx + 1 :])
    return body, delay


async def run_demo(
    source: str,
    namespace: MutableMapping[str, Any] | None = None,
    *,
    delay: float = 0.2,
    filename: str = "<mv.demo>",
    on_step: Callable[[int, int, str, str], Any] | None = None,
) -> None:
    """Execute top-level statements of *source* one-by-one.

    Parameters
    ----------
    source
        Python source **without** the ``%%mv.demo`` magic line.
    namespace
        Execution globals (defaults to a fresh dict with ``__name__``).
    delay
        Seconds to wait between statements and loop iterations.
    filename
        Synthesized filename for compile/tracebacks.
    on_step
        Optional ``(index, total, status, message)`` callback after each
        statement (``status`` is ``\"ok\"`` or ``\"error\"``).
    """
    if delay is None or float(delay) < 0:
        raise ValueError("delay must be zero or greater")
    interval = float(delay)
    tree = ast.parse(source, filename=filename, mode="exec")
    body = list(tree.body)
    total = len(body)
    if total == 0:
        return

    ns: MutableMapping[str, Any]
    if namespace is None:
        ns = {"__name__": "__mv_demo__"}
    else:
        ns = namespace

    async def _interruptible_sleep(seconds: float) -> None:
        """Sleep in short slices so Interrupt is noticed within ~50ms.

        A single ``await asyncio.sleep(1.0)`` only ends on task cancel;
        under Pyodide the Interrupt button often cannot re-enter Python to
        cancel the task while ``run_sync`` holds the stack. Chunked sleep
        + :func:`check_interrupt` (which also polls the host JS latch)
        keeps demos responsive.
        """
        remaining = float(seconds)
        while remaining > 0:
            check_interrupt()
            step = 0.05 if remaining > 0.05 else remaining
            await asyncio.sleep(step)
            remaining -= step
        check_interrupt()

    async def iteration_step() -> None:
        # Cooperative cancel at every loop-iteration beat.
        await _interruptible_sleep(interval)

    ns[_STEP_HELPER] = iteration_step

    flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT

    for index, statement in enumerate(body):
        check_interrupt()
        try:
            if isinstance(statement, ast.Expr):
                expr = ast.Expression(body=statement.value)
                ast.fix_missing_locations(expr)
                code = compile(expr, filename=filename, mode="eval", flags=flags)
                result = eval(code, ns, ns)
                await _maybe_await(result)
            else:
                paced = _LoopPacer().visit(statement)
                module = ast.Module(body=[paced], type_ignores=[])
                ast.fix_missing_locations(module)
                code = compile(
                    module, filename=filename, mode="exec", flags=flags
                )
                result = eval(code, ns, ns)
                await _maybe_await(result)
            if on_step is not None:
                await _maybe_await(on_step(index, total, "ok", ""))
        except Exception as exc:
            if on_step is not None:
                await _maybe_await(
                    on_step(
                        index,
                        total,
                        "error",
                        f"{type(exc).__name__}: {exc}",
                    )
                )
            raise

        if index < total - 1:
            await _interruptible_sleep(interval)


def default_namespace(
    *,
    extras: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Namespace with ``math`` and optional extras (e.g. ``mv``, ``stage``)."""
    import math

    ns: dict[str, Any] = {
        "__name__": "__mv_demo__",
        "math": math,
        "sys": sys,
    }
    if extras:
        ns.update(extras)
    return ns


def demo_cell_transform(lines: list[str]) -> list[str]:
    """IPython input transformer that makes ``%%mv.demo`` an awaited call.

    Registered on ``shell.input_transformers_cleanup``, which runs *before*
    IPython's own ``cell_magic`` transform — so the cell never reaches the
    magic lookup that would reject it.

    A cell magic cannot do this job: ``InteractiveShell.run_cell_magic`` calls
    ``result = fn(*args, **kwargs)`` and discards the result without awaiting,
    while :func:`run_demo` is a coroutine. Rewriting to top-level ``await``
    keeps the cell genuinely blocked until the demo finishes, so the next cell
    does not race it.

    Cells that do not open with the magic are returned untouched.
    """
    if not lines or not lines[0].lstrip().startswith("%%mv.demo"):
        return lines
    body, delay = strip_demo_magic("".join(lines))
    return [f"await __import__('molvis').run_demo({body!r}, globals(), delay={delay!r})\n"]
