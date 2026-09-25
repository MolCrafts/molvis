"""Named viewer sessions an agent can drive, and the state between calls.

Why this exists
---------------

A viewer is not a command. An agent that draws a molecule, rotates it,
selects an atom and then asks what is selected needs the *same* viewer and
the *same* Python objects across four separate turns, and a CLI cannot give
it that: every invocation is a fresh process. This module owns exactly what
survives between turns —

* the scene itself (:class:`~molvis.Molvis` already registers scenes by
  name, so this module keeps no second copy of that registry),
* one persistent Python namespace per session, so ``frame`` bound in one
  call is still bound in the next,
* a journal of frontend events with a cursor, so a caller can ask "what
  happened since I last looked" instead of racing a callback.

Deliberately no domain verbs. There is no ``draw`` here, no ``show_smiles``,
no command envelope: an agent writes ordinary molvis Python through
:meth:`Workbench.run`, so a capability added upstream needs no change in
this file. What is here is the runtime a reader of the source cannot infer:
a stage that stays alive and the objects that outlive one call.

No MCP machinery is imported. :mod:`molvis.mcp.server` wraps this in FastMCP
tools; everything below is plain Python and is unit-tested with a fake scene,
no server and no browser.

Trust model: a local workbench, on par with a notebook kernel.
:meth:`Workbench.run` is unsandboxed by design — the operator started the
process themselves.
"""

from __future__ import annotations

import ast
import contextlib
import inspect
import io
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

#: Events mirrored into a session's journal. Named explicitly because
#: :meth:`molvis.events.EventBus.on` takes one event name and has no
#: wildcard: a bus that grew a fifth event would be journalled only after
#: this tuple learns about it, which is preferable to a silent subscription
#: to everything a future frontend decides to emit.
SUBSCRIBED_EVENTS: tuple[str, ...] = (
    "selection_changed",
    "mode_changed",
    "frame_changed",
    "hello_state",
)

#: How many events one :meth:`Workbench.poll` returns when the caller names
#: no limit.
DEFAULT_POLL_LIMIT = 100

#: How many events one session's journal retains. Older entries are dropped
#: from the front, and a caller whose cursor has fallen behind that window is
#: told so rather than handed a silent gap.
JOURNAL_LIMIT = 1000


class Scene(Protocol):
    """The slice of :class:`~molvis.Molvis` this module requires.

    One required member — ``close`` — because tearing a scene down is the
    only thing the workbench ever does *to* one; everything an agent wants
    from a viewer is reached by writing molvis Python inside
    :meth:`Workbench.run`, so those names never appear here.

    ``on``, ``connected``, ``connection_url`` and ``session_info`` are read
    defensively with :func:`getattr`. A double that offers only ``close``
    still works; it just has no event feed and reports less.
    """

    def close(self) -> Any: ...


#: Builds a scene for one session name. Injected so tests drive a fake.
SceneFactory = Callable[..., Any]


def default_scene_factory(name: str, **config: Any) -> Any:
    """Construct a real :class:`~molvis.Molvis` scene.

    The import is deferred: constructing a :class:`Workbench` must not pull
    the viewer stack (and its transport) into a process that may only be
    listing sessions.

    Parameters
    ----------
    name
        Session name, passed straight through as the scene's ``name`` so
        molvis's own registry is the one that holds it.
    **config
        Forwarded to :class:`~molvis.Molvis` (``gui``, ``width``,
        ``height``, ``transport``, ...).

    Returns
    -------
    molvis.Molvis
        The scene, started according to the runtime molvis detected.
    """
    from molvis import Molvis

    return Molvis(name=name, **config)


@dataclass
class _Bench:
    """One live session: its scene, its namespace, and its event journal."""

    scene: Any
    namespace: dict[str, Any]
    opened_at: float
    journal: list[dict[str, Any]] = field(default_factory=list)
    handles: list[Any] = field(default_factory=list)
    #: Sequence number of the last event appended. Cursors are compared
    #: against this, never against list indices, so trimming the journal
    #: cannot renumber events a caller already read.
    seq: int = 0
    #: Sequence number of the oldest event still retained.
    first_seq: int = 1


class Workbench:
    """Open, drive and close named viewer sessions.

    Parameters
    ----------
    scene_factory
        Builds the scene for a session name. Defaults to
        :func:`default_scene_factory`; tests pass a fake so the whole
        workbench is exercised without a browser.

    Notes
    -----
    Every public method is safe to call from several threads: the frontend
    delivers events on the transport's thread while a tool call runs on
    another, and the journal is written by the first and read by the second.
    """

    def __init__(self, scene_factory: SceneFactory | None = None) -> None:
        self._factory: SceneFactory = scene_factory or default_scene_factory
        self._benches: dict[str, _Bench] = {}
        self._lock = threading.RLock()

    # -- lifecycle ------------------------------------------------------

    def open(self, name: str | None = None, **config: Any) -> dict[str, Any]:
        """Open a session, or return the one that already has this name.

        Re-opening an existing name is not an error and does not rebuild
        anything: the whole point of a named session is that a later turn
        can reach the objects an earlier turn left behind.

        Parameters
        ----------
        name
            Session name. ``None`` mints one.
        **config
            Forwarded to the scene factory on a *new* session. Ignored,
            with a note in the result, when the session already exists —
            silently applying it would claim a reconfiguration that did
            not happen.

        Returns
        -------
        dict
            ``session``, ``created``, ``connection_url``, ``connected``,
            and ``info`` (the scene's own ``session_info`` when it has one).
        """
        with self._lock:
            session = name or f"molvis-{uuid.uuid4().hex[:12]}"
            existing = self._benches.get(session)
            if existing is not None:
                return {
                    "session": session,
                    "created": False,
                    "config_ignored": bool(config),
                    **self._state(existing),
                }
            scene = self._factory(session, **config)
            bench = _Bench(scene=scene, namespace={}, opened_at=time.time())
            # ``viewer``, not ``mv``: molvis's own documentation spells
            # ``import molvis as mv``, so binding the *scene* to that name would
            # shadow the module in the one namespace where an agent is most
            # likely to want both.
            bench.namespace.update({"viewer": scene, "session": session})
            self._subscribe(bench)
            self._benches[session] = bench
            return {"session": session, "created": True, **self._state(bench)}

    def close(self, name: str) -> dict[str, Any]:
        """Close one session: unsubscribe, drop the namespace, close the scene.

        Parameters
        ----------
        name
            Session name.

        Returns
        -------
        dict
            ``session`` and ``closed``. ``closed`` is ``False`` for a name
            that was not open, which is reported rather than raised: a
            caller tidying up after a crash should not have to ask first.
        """
        with self._lock:
            bench = self._benches.pop(name, None)
        if bench is None:
            return {"session": name, "closed": False}
        for handle in bench.handles:
            remove = getattr(handle, "remove", None)
            if callable(remove):
                with contextlib.suppress(Exception):
                    remove()
        bench.handles.clear()
        bench.namespace.clear()
        with contextlib.suppress(Exception):
            bench.scene.close()
        return {"session": name, "closed": True}

    def list(self) -> list[dict[str, Any]]:
        """Describe every open session, oldest first.

        Returns
        -------
        list of dict
            One entry per session: ``session``, ``connected``,
            ``connection_url``, ``info``, ``opened_at``, ``events`` (the
            journal's high-water sequence) and ``names`` (what the session's
            namespace currently binds, so a caller can see what a previous
            turn left there).
        """
        with self._lock:
            benches = sorted(self._benches.items(), key=lambda kv: kv[1].opened_at)
            return [
                {
                    "session": name,
                    "opened_at": bench.opened_at,
                    "events": bench.seq,
                    "names": sorted(
                        key
                        for key in bench.namespace
                        if not key.startswith("_") and key != "viewer"
                    ),
                    **self._state(bench),
                }
                for name, bench in benches
            ]

    # -- driving --------------------------------------------------------

    def run(self, name: str, code: str) -> dict[str, Any]:
        """Execute *code* in the session's persistent namespace.

        The namespace binds ``viewer`` to the scene. A trailing expression is
        evaluated rather than discarded, so ``viewer.selection`` answers with a
        value the way it would in a REPL.

        Parameters
        ----------
        name
            Session name; must be open.
        code
            Python source. Statements and a trailing expression are both
            accepted.

        Returns
        -------
        dict
            ``ok``; ``stdout``; ``result`` (``repr`` of the trailing
            expression, or ``None``); and on failure ``error`` — the
            traceback as text, because the caller is an agent that has to
            read it rather than a debugger that can step.
        """
        bench = self._require(name)
        stdout = io.StringIO()
        try:
            statements, trailing = _split_trailing_expression(code)
        except SyntaxError as exc:
            return {
                "ok": False,
                "stdout": "",
                "result": None,
                "error": f"SyntaxError: {exc}",
            }
        result: Any = None
        try:
            with contextlib.redirect_stdout(stdout):
                if statements is not None:
                    exec(statements, bench.namespace)  # noqa: S102 - by design
                if trailing is not None:
                    result = eval(trailing, bench.namespace)  # noqa: S307 - by design
        except BaseException:  # noqa: BLE001 - reported, never swallowed
            return {
                "ok": False,
                "stdout": stdout.getvalue(),
                "result": None,
                "error": traceback.format_exc(),
            }
        return {
            "ok": True,
            "stdout": stdout.getvalue(),
            "result": None if result is None else repr(result),
            "error": None,
        }

    def poll(
        self,
        name: str,
        cursor: int | None = None,
        limit: int = DEFAULT_POLL_LIMIT,
    ) -> dict[str, Any]:
        """Read journalled events after *cursor*.

        Parameters
        ----------
        name
            Session name; must be open.
        cursor
            Sequence number the caller already has. ``None`` starts from the
            oldest retained event.
        limit
            Maximum events to return; clamped to at least one.

        Returns
        -------
        dict
            ``events``, ``cursor`` (pass back next time), ``pending``
            (events still unread after this batch) and ``dropped`` — true
            when the journal had already discarded events the cursor asked
            for, so a gap is stated instead of looking like quiet.
        """
        bench = self._require(name)
        with self._lock:
            start = bench.first_seq - 1 if cursor is None else cursor
            dropped = start < bench.first_seq - 1
            selected = [event for event in bench.journal if event["seq"] > start]
            batch = selected[: max(1, limit)]
            next_cursor = batch[-1]["seq"] if batch else max(start, bench.seq)
            return {
                "session": name,
                "events": batch,
                "cursor": next_cursor,
                "pending": len(selected) - len(batch),
                "dropped": dropped,
            }

    def describe(self, name: str) -> dict[str, Any]:
        """Report what this session's scene can do, and which build it is.

        Reflection, not a hand-kept list: the callables are read off the
        live object, so a method added upstream shows up here without an
        edit. That is the same rule the rest of this module keeps — nothing
        restates a domain surface it does not own.

        Parameters
        ----------
        name
            Session name; must be open.

        Returns
        -------
        dict
            ``session``, ``molvis`` (version, when importable), ``info``,
            and ``methods`` — one ``{name, signature, summary}`` per public
            callable on the scene.
        """
        bench = self._require(name)
        return {
            "session": name,
            "molvis": _molvis_version(),
            "info": _scene_info(bench.scene),
            "methods": _public_methods(bench.scene),
        }

    # -- internals ------------------------------------------------------

    def _require(self, name: str) -> _Bench:
        """Return the named session, or say which names exist.

        Raises
        ------
        KeyError
            No session by that name. The message lists the open ones,
            because the caller's next move is to pick one and a bare
            "unknown session" leaves it guessing.
        """
        with self._lock:
            bench = self._benches.get(name)
            if bench is not None:
                return bench
            open_names = ", ".join(sorted(self._benches)) or "(none)"
        raise KeyError(f"no open session named {name!r}; open sessions: {open_names}")

    def _subscribe(self, bench: _Bench) -> None:
        """Mirror the scene's events into the journal, best effort.

        A scene without ``on`` — a test double, a future transport — opens
        without a feed rather than failing to open at all.
        """
        subscribe = getattr(bench.scene, "on", None)
        if not callable(subscribe):
            return
        for event in SUBSCRIBED_EVENTS:
            with contextlib.suppress(Exception):
                bench.handles.append(subscribe(event, _writer(self, bench, event)))

    def _append(self, bench: _Bench, event: str, payload: Any) -> None:
        """Append one event to *bench*'s journal, trimming the oldest."""
        with self._lock:
            bench.seq += 1
            bench.journal.append(
                {
                    "seq": bench.seq,
                    "event": event,
                    "at": time.time(),
                    "payload": payload,
                }
            )
            overflow = len(bench.journal) - JOURNAL_LIMIT
            if overflow > 0:
                del bench.journal[:overflow]
                bench.first_seq = bench.journal[0]["seq"]

    def _state(self, bench: _Bench) -> dict[str, Any]:
        """Connection facts for one session, each one optional on the scene."""
        return {
            "connected": bool(getattr(bench.scene, "connected", False)),
            "connection_url": str(getattr(bench.scene, "connection_url", "") or ""),
            "info": _scene_info(bench.scene),
        }


def _writer(
    workbench: Workbench, bench: _Bench, event: str
) -> Callable[[dict[str, Any]], None]:
    """Build the callback that journals one event type."""

    def _write(payload: dict[str, Any]) -> None:
        workbench._append(bench, event, payload)

    return _write


def _split_trailing_expression(code: str) -> tuple[Any, Any]:
    """Split *code* into compiled statements and a trailing expression.

    Parameters
    ----------
    code
        Python source.

    Returns
    -------
    tuple
        ``(statements, trailing)``, either of which may be ``None`` — for
        code that is only statements, and for code that is only an
        expression.

    Raises
    ------
    SyntaxError
        The source does not parse. Raised here so the caller reports it as
        a result rather than as a crash.
    """
    tree = ast.parse(code, mode="exec")
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        head = ast.Module(body=tree.body[:-1], type_ignores=[])
        tail = ast.Expression(body=tree.body[-1].value)
        statements = compile(head, "<molvis-mcp>", "exec") if head.body else None
        return statements, compile(tail, "<molvis-mcp>", "eval")
    return compile(tree, "<molvis-mcp>", "exec"), None


def _scene_info(scene: Any) -> dict[str, Any]:
    """The scene's own ``session_info``, or an empty dict when it has none."""
    info = getattr(scene, "session_info", None)
    if isinstance(info, dict):
        return dict(info)
    return {}


def _public_methods(scene: Any) -> list[dict[str, str]]:
    """Reflect the scene's public callables into name/signature/summary."""
    methods: list[dict[str, str]] = []
    for name in sorted(dir(scene)):
        if name.startswith("_"):
            continue
        try:
            member = getattr(scene, name)
        except Exception:  # noqa: BLE001 - a property may raise; skip it
            continue
        if not callable(member):
            continue
        signature = _signature_of(member)
        doc = inspect.getdoc(member) or ""
        methods.append(
            {
                "name": name,
                "signature": signature,
                "summary": doc.strip().splitlines()[0] if doc.strip() else "",
            }
        )
    return methods


def _signature_of(member: Any) -> str:
    """Render *member*'s signature with annotations resolved where possible.

    ``eval_str=True`` is tried first because molvis modules carry
    ``from __future__ import annotations``, which would otherwise render every
    parameter as a quoted string — ``(what: 'str')`` — and an agent reading
    that has to guess whether the quotes are part of the type. A name that
    cannot be resolved (an import guarded by ``TYPE_CHECKING``) falls back to
    the unevaluated form rather than dropping the method.
    """
    for kwargs in ({"eval_str": True}, {}):
        try:
            return str(inspect.signature(member, **kwargs))
        except Exception:  # noqa: BLE001 - a signature is never worth a failure
            continue
    return "(...)"


def _molvis_version() -> str:
    """molvis's version, or ``""`` when the package is not importable."""
    try:
        from molvis import __version__
    except Exception:  # noqa: BLE001 - reporting a version must never fail a call
        return ""
    return str(__version__)


__all__ = [
    "DEFAULT_POLL_LIMIT",
    "JOURNAL_LIMIT",
    "SUBSCRIBED_EVENTS",
    "Scene",
    "SceneFactory",
    "Workbench",
    "default_scene_factory",
]
