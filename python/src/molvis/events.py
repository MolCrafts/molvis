"""
Frontend event bus and cached viewer state on the Python side.

The :class:`WebSocketTransport` dispatches inbound JSON-RPC notifications
(no ``id``, ``method`` starting with ``event.``) into an :class:`EventBus`.
The bus does two things:

1. Updates :class:`ViewerState` for known events (selection, mode, frame)
   so that ``viewer.selection`` / ``viewer.current_mode`` / ``viewer.current_frame``
   are correct without a roundtrip.
2. Fans the event out to user-registered callbacks.

User callbacks fire on the transport's asyncio thread — not the main
thread. Synchronous code that wants to *wait* for a specific event
(e.g. "block until user clicks an atom") should use :meth:`EventBus.wait_for`
instead of registering a callback.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field, replace
from queue import Empty, Queue
from typing import Any

logger = logging.getLogger("molvis")

__all__ = [
    "EventBus",
    "EventHandle",
    "Selection",
    "ViewerState",
    "normalize_event_name",
]


# ----------------------------------------------------------------------
# Value types
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class Selection:
    """Immutable snapshot of the current atom/bond selection."""

    atom_ids: tuple[int, ...] = ()
    bond_ids: tuple[int, ...] = ()

    def __iter__(self) -> Iterator[int]:
        """Iterate atom ids (most-common ergonomic access)."""
        return iter(self.atom_ids)

    def __len__(self) -> int:
        return len(self.atom_ids) + len(self.bond_ids)

    def __bool__(self) -> bool:
        return bool(self.atom_ids) or bool(self.bond_ids)


@dataclass
class ViewerState:
    """Mutable cache of frontend state observable from Python."""

    selection: Selection = field(default_factory=Selection)
    mode: str = "view"
    frame_index: int = 0
    total_frames: int = 0


# ----------------------------------------------------------------------
# EventBus
# ----------------------------------------------------------------------


def normalize_event_name(event: str) -> str:
    """Accept both ``event.selection_changed`` and ``selection_changed``.

    Internally listeners are keyed by the short name.
    """
    return event.removeprefix("event.")


class EventHandle:
    """Handle returned by :meth:`EventBus.on`; call :meth:`remove` to
    unsubscribe."""

    def __init__(self, remove_fn: Callable[[], None]) -> None:
        self._remove = remove_fn
        self._active = True

    def remove(self) -> None:
        if self._active:
            self._active = False
            self._remove()


class EventBus:
    """Dispatches frontend events to registered callbacks and updates
    the :class:`ViewerState` cache.

    Thread-safe: listener registration and dispatch may happen from
    different threads (main ↔ WS server).
    """

    def __init__(self, state: ViewerState | None = None) -> None:
        self._state = state if state is not None else ViewerState()
        self._lock = threading.RLock()
        self._listeners: dict[str, list[Callable[[dict[str, Any]], None]]] = {}
        self._waiters: list[_Waiter] = []

    @property
    def state(self) -> ViewerState:
        return self._state

    # ------------------------------------------------------------------
    # Subscription
    # ------------------------------------------------------------------

    def on(
        self,
        event: str,
        callback: Callable[[dict[str, Any]], None],
    ) -> EventHandle:
        name = normalize_event_name(event)
        with self._lock:
            self._listeners.setdefault(name, []).append(callback)

        def _remove() -> None:
            with self._lock:
                listeners = self._listeners.get(name)
                if listeners is None:
                    return
                try:
                    listeners.remove(callback)
                except ValueError:
                    return
                if not listeners:
                    self._listeners.pop(name, None)

        return EventHandle(_remove)

    def wait_for(
        self,
        event: str,
        *,
        timeout: float = 30.0,
        predicate: Callable[[dict[str, Any]], bool] | None = None,
    ) -> dict[str, Any]:
        """Block until an event matching *event* (and *predicate*) fires.

        Returns the event's params dict. Raises :class:`TimeoutError`
        if *timeout* elapses first.
        """
        name = normalize_event_name(event)
        waiter = _Waiter(name, predicate)
        with self._lock:
            self._waiters.append(waiter)
        try:
            try:
                return waiter.queue.get(timeout=timeout)
            except Empty:
                raise TimeoutError(
                    f"Timed out after {timeout}s waiting for '{event}'"
                ) from None
        finally:
            with self._lock:
                try:
                    self._waiters.remove(waiter)
                except ValueError:
                    pass

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------

    def dispatch(self, method: str, params: dict[str, Any]) -> None:
        """Entry point used by the transport. Updates cache, fans out."""
        name = normalize_event_name(method)
        self._update_state(name, params)

        with self._lock:
            listeners = list(self._listeners.get(name, ()))
            waiters_to_resolve = [w for w in self._waiters if w.matches(name, params)]
            for w in waiters_to_resolve:
                self._waiters.remove(w)

        for callback in listeners:
            try:
                callback(params)
            except Exception:
                logger.exception("Event listener for '%s' raised", name)

        for waiter in waiters_to_resolve:
            waiter.queue.put_nowait(params)

    # ------------------------------------------------------------------
    # Internal: cache updates for known events
    # ------------------------------------------------------------------

    def _update_state(self, name: str, params: dict[str, Any]) -> None:
        if name == "hello_state":
            sel_raw = params.get("selection") or {}
            if isinstance(sel_raw, dict):
                self._state.selection = _selection_from_payload(sel_raw)
            if isinstance(params.get("mode"), str):
                self._state.mode = params["mode"]
            if isinstance(params.get("frame_index"), int):
                self._state.frame_index = params["frame_index"]
            if isinstance(params.get("total_frames"), int):
                self._state.total_frames = params["total_frames"]
            return

        if name == "selection_changed":
            self._state.selection = _selection_from_payload(params)
            return

        if name == "mode_changed":
            mode = params.get("mode")
            if isinstance(mode, str):
                self._state.mode = mode
            return

        if name == "frame_changed":
            idx = params.get("index")
            if isinstance(idx, int):
                self._state.frame_index = idx
            total = params.get("total")
            if isinstance(total, int):
                self._state.total_frames = total
            return

    # Pass-through for tests and snapshot refresh.
    def prime_state(self, snapshot: dict[str, Any]) -> None:
        """Seed the cache from a one-shot ``state.get`` response."""
        self.dispatch("event.hello_state", snapshot)

    def snapshot(self) -> ViewerState:
        """Return an immutable copy of the current cache state."""
        with self._lock:
            return replace(self._state)


# ----------------------------------------------------------------------
# Internal helpers
# ----------------------------------------------------------------------


class _Waiter:
    __slots__ = ("event", "predicate", "queue")

    def __init__(
        self,
        event: str,
        predicate: Callable[[dict[str, Any]], bool] | None,
    ) -> None:
        self.event = event
        self.predicate = predicate
        self.queue: Queue[dict[str, Any]] = Queue(maxsize=1)

    def matches(self, name: str, params: dict[str, Any]) -> bool:
        if name != self.event:
            return False
        if self.predicate is None:
            return True
        try:
            return bool(self.predicate(params))
        except Exception:
            logger.exception("wait_for predicate raised")
            return False


def _selection_from_payload(payload: dict[str, Any]) -> Selection:
    raw_atoms = payload.get("atom_ids") or []
    raw_bonds = payload.get("bond_ids") or []
    atoms: tuple[int, ...] = ()
    bonds: tuple[int, ...] = ()
    if isinstance(raw_atoms, (list, tuple)):
        atoms = tuple(int(x) for x in raw_atoms if isinstance(x, (int, float)))
    if isinstance(raw_bonds, (list, tuple)):
        bonds = tuple(int(x) for x in raw_bonds if isinstance(x, (int, float)))
    return Selection(atom_ids=atoms, bond_ids=bonds)
