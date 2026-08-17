"""Selection state flows from frontend → Python via the event channel."""

from __future__ import annotations

import threading

import pytest

from molvis import Molvis, Selection
from molvis.events import EventBus


class _FakeTransport:
    """Minimal Transport stand-in for unit tests: no server, no I/O."""

    def __init__(self) -> None:
        self.event_bus: EventBus | None = None
        self.sent: list[tuple[str, dict]] = []
        self.next_response: dict | None = None

    def attach_event_bus(self, bus: EventBus) -> None:
        self.event_bus = bus

    def start(self) -> int:
        return 0

    def stop(self) -> None:
        return None

    def send_request(
        self,
        method: str,
        params: dict,
        *,
        buffers=None,
        wait_for_response: bool = False,
        timeout: float = 10.0,
    ):
        self.sent.append((method, params))
        return self.next_response


@pytest.fixture(autouse=True)
def _reset_registry() -> None:
    Molvis._scene_registry.clear()
    yield
    Molvis._scene_registry.clear()


def test_selection_is_empty_on_fresh_viewer() -> None:
    viewer = Molvis(name="sel-empty", transport=_FakeTransport())
    assert viewer.selection == Selection()
    assert viewer.current_mode == "view"
    assert viewer.current_frame == 0
    assert viewer.n_frames == 0


def test_selection_reflects_pushed_event() -> None:
    viewer = Molvis(name="sel-push", transport=_FakeTransport())
    viewer.events.dispatch(
        "event.selection_changed",
        {"atom_ids": [1, 2, 3], "bond_ids": [7]},
    )
    assert viewer.selection == Selection(atom_ids=(1, 2, 3), bond_ids=(7,))


def test_on_selection_callback_fires() -> None:
    viewer = Molvis(name="sel-cb", transport=_FakeTransport())
    seen: list[dict] = []
    handle = viewer.on("selection_changed", lambda ev: seen.append(ev))

    viewer.events.dispatch("event.selection_changed", {"atom_ids": [9]})
    handle.remove()
    viewer.events.dispatch("event.selection_changed", {"atom_ids": [10]})

    assert len(seen) == 1
    assert seen[0]["atom_ids"] == [9]


def test_wait_for_selection_blocks_until_dispatched() -> None:
    viewer = Molvis(name="sel-wait", transport=_FakeTransport())

    def fire() -> None:
        import time

        time.sleep(0.05)
        viewer.events.dispatch(
            "event.selection_changed",
            {"atom_ids": [42], "bond_ids": []},
        )

    t = threading.Thread(target=fire, daemon=True)
    t.start()
    result = viewer.wait_for("selection_changed", timeout=2.0)
    t.join(timeout=1)
    assert result["atom_ids"] == [42]


def test_refresh_state_fires_state_get_and_primes_cache() -> None:
    fake = _FakeTransport()
    fake.next_response = {
        "selection": {"atom_ids": [11], "bond_ids": []},
        "mode": "edit",
        "frame_index": 4,
        "total_frames": 10,
    }
    viewer = Molvis(name="sel-refresh", transport=fake)
    snap = viewer.refresh_state()

    assert fake.sent[0][0] == "state.get"
    assert snap.mode == "edit"
    assert viewer.selection == Selection(atom_ids=(11,), bond_ids=())
    assert viewer.current_frame == 4
    assert viewer.n_frames == 10


def test_mode_and_frame_cache_update_from_events() -> None:
    viewer = Molvis(name="mode-cache", transport=_FakeTransport())
    viewer.events.dispatch("event.mode_changed", {"mode": "measure"})
    viewer.events.dispatch("event.frame_changed", {"index": 7, "total": 20})
    assert viewer.current_mode == "measure"
    assert viewer.current_frame == 7
    assert viewer.n_frames == 20
