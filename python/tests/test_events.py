"""Tests for molvis.events: EventBus, ViewerState, Selection."""

from __future__ import annotations

import threading
import time

import pytest
from molvis.events import EventBus, Selection, ViewerState, normalize_event_name


def test_normalize_event_name_strips_prefix() -> None:
    assert normalize_event_name("event.selection_changed") == "selection_changed"
    assert normalize_event_name("selection_changed") == "selection_changed"


def test_selection_is_immutable_and_sized() -> None:
    sel = Selection(atom_ids=(1, 2, 3), bond_ids=(10,))
    assert len(sel) == 4
    assert list(iter(sel)) == [1, 2, 3]
    assert bool(sel) is True
    assert bool(Selection()) is False


def test_on_registers_and_removes_listener() -> None:
    bus = EventBus()
    events: list[dict] = []
    handle = bus.on("selection_changed", lambda ev: events.append(ev))

    bus.dispatch("event.selection_changed", {"atom_ids": [1]})
    handle.remove()
    bus.dispatch("event.selection_changed", {"atom_ids": [2]})

    assert len(events) == 1
    assert events[0]["atom_ids"] == [1]


def test_dispatch_updates_selection_cache() -> None:
    state = ViewerState()
    bus = EventBus(state)
    bus.dispatch("event.selection_changed", {"atom_ids": [5, 6], "bond_ids": [9]})
    assert state.selection == Selection(atom_ids=(5, 6), bond_ids=(9,))


def test_dispatch_updates_mode_cache() -> None:
    state = ViewerState()
    bus = EventBus(state)
    bus.dispatch("event.mode_changed", {"mode": "edit"})
    assert state.mode == "edit"


def test_dispatch_updates_frame_cache() -> None:
    state = ViewerState()
    bus = EventBus(state)
    bus.dispatch("event.frame_changed", {"index": 12, "total": 30})
    assert state.frame_index == 12
    assert state.total_frames == 30


def test_hello_state_seeds_full_cache() -> None:
    state = ViewerState()
    bus = EventBus(state)
    bus.dispatch(
        "event.hello_state",
        {
            "selection": {"atom_ids": [1, 2], "bond_ids": []},
            "mode": "select",
            "frame_index": 3,
            "total_frames": 10,
        },
    )
    assert state.selection == Selection(atom_ids=(1, 2), bond_ids=())
    assert state.mode == "select"
    assert state.frame_index == 3
    assert state.total_frames == 10


def test_wait_for_resolves_on_matching_event() -> None:
    bus = EventBus()
    result: dict = {}

    def fire_later() -> None:
        time.sleep(0.05)
        bus.dispatch("event.selection_changed", {"atom_ids": [99]})

    thread = threading.Thread(target=fire_later, daemon=True)
    thread.start()
    params = bus.wait_for("selection_changed", timeout=2.0)
    result.update(params)
    thread.join(timeout=1)

    assert result["atom_ids"] == [99]


def test_wait_for_predicate_filters() -> None:
    bus = EventBus()

    def fire_many() -> None:
        time.sleep(0.05)
        bus.dispatch("event.frame_changed", {"index": 0, "total": 10})
        time.sleep(0.02)
        bus.dispatch("event.frame_changed", {"index": 5, "total": 10})

    thread = threading.Thread(target=fire_many, daemon=True)
    thread.start()
    params = bus.wait_for(
        "frame_changed",
        timeout=2.0,
        predicate=lambda ev: ev.get("index", 0) >= 5,
    )
    thread.join(timeout=1)
    assert params["index"] == 5


def test_wait_for_times_out() -> None:
    bus = EventBus()
    with pytest.raises(TimeoutError):
        bus.wait_for("selection_changed", timeout=0.1)


def test_listener_exceptions_do_not_break_dispatch() -> None:
    bus = EventBus()
    collected: list[dict] = []

    bus.on("selection_changed", lambda _ev: (_ for _ in ()).throw(RuntimeError("oops")))
    bus.on("selection_changed", lambda ev: collected.append(ev))

    bus.dispatch("event.selection_changed", {"atom_ids": [7]})
    assert collected == [{"atom_ids": [7]}]


def test_snapshot_returns_independent_copy() -> None:
    state = ViewerState()
    bus = EventBus(state)
    bus.dispatch("event.mode_changed", {"mode": "edit"})
    snap = bus.snapshot()
    assert snap.mode == "edit"
    # mutating original state afterwards should not affect the snapshot copy
    bus.dispatch("event.mode_changed", {"mode": "view"})
    assert snap.mode == "edit"
    assert state.mode == "view"
