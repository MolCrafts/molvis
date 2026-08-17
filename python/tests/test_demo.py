"""Unit tests for molvis.demo step runner and %%mv.demo magic stripping."""

from __future__ import annotations

import asyncio
import importlib

import pytest


def _load_demo():
    """Import molvis.demo. See the note in test_control.import_control_module —
    the old by-path loader installed a fake `molvis` into sys.modules and broke
    every module imported after it."""
    return importlib.import_module("molvis.demo")


demo_mod = _load_demo()
run_demo = demo_mod.run_demo
strip_demo_magic = demo_mod.strip_demo_magic
demo_cell_transform = demo_mod.demo_cell_transform


def test_strip_demo_magic_absent():
    body, delay = strip_demo_magic("print(1)\n")
    assert delay is None
    assert body == "print(1)\n"


def test_strip_demo_magic_default_delay():
    body, delay = strip_demo_magic("%%mv.demo\nx = 1\n")
    assert delay == 0.2
    assert body == "x = 1\n"


def test_strip_demo_magic_delay_kw():
    body, delay = strip_demo_magic("%%mv.demo delay=0.5\nprint(1)\n")
    assert delay == 0.5
    assert "print(1)" in body


def test_strip_demo_magic_rejects_unclear_option():
    import pytest

    with pytest.raises(ValueError, match="delay"):
        strip_demo_magic("%%mv.demo rate=3\ny = 2\n")


def test_run_demo_executes_statements_in_order(monkeypatch):
    seen: list[int] = []

    async def _instant(_dt):
        return None

    monkeypatch.setattr(asyncio, "sleep", _instant)

    ns: dict = {"seen": seen}
    asyncio.run(
        run_demo(
            "seen.append(1)\nseen.append(2)\nseen.append(3)\n",
            ns,
            delay=0.1,
        )
    )
    assert seen == [1, 2, 3]


def test_run_demo_awaits_coroutines(monkeypatch):
    order: list[str] = []

    async def step():
        order.append("step")

    async def _instant(_dt):
        order.append("sleep")

    monkeypatch.setattr(asyncio, "sleep", _instant)

    ns = {"step": step, "order": order}
    asyncio.run(run_demo("await step()\norder.append('done')\n", ns, delay=0.01))
    assert order[0] == "step"
    assert order[-1] == "done"


def test_run_demo_paces_each_loop_iteration(monkeypatch):
    sleeps: list[float] = []

    async def _record(dt):
        sleeps.append(dt)

    monkeypatch.setattr(asyncio, "sleep", _record)
    ns = {"seen": []}
    asyncio.run(run_demo("for value in range(3):\n    seen.append(value)\n", ns, delay=0.25))

    assert ns["seen"] == [0, 1, 2]
    # Three iterations, 0.25 s of pacing each.
    assert sum(sleeps) == pytest.approx(0.75)
    # Sliced, so Interrupt is noticed within ~50 ms — a single long sleep is
    # unresponsive under Pyodide (see `_interruptible_sleep`).
    assert max(sleeps) <= 0.05


def test_demo_cell_transform_rewrites_magic_to_awaited_call():
    out = demo_cell_transform(["%%mv.demo delay=0.5\n", "stage.set_style(s)\n"])

    assert len(out) == 1
    # Top-level await, not a cell magic: IPython's run_cell_magic never awaits.
    assert out[0].startswith("await ")
    assert "run_demo(" in out[0]
    assert "delay=0.5" in out[0]
    assert "stage.set_style(s)" in out[0]


def test_demo_cell_transform_leaves_ordinary_cells_untouched():
    lines = ["import molpy as mp\n", "print(mp)\n"]

    assert demo_cell_transform(lines) is lines


def test_demo_cell_transform_output_is_valid_python():
    import ast

    out = demo_cell_transform(["%%mv.demo\n", "for i in range(2):\n", "    print(i)\n"])

    # A body with a loop must survive quoting; compiling proves the rewrite is
    # not merely string-shaped. Top-level `await` needs the same flag the
    # notebook kernel uses.
    compile(out[0], "<cell>", "exec", ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
