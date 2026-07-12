"""Tests for the state-sync handler on ``Molvis``.

The handler fires when the frontend sends an ``event.request_state_sync``
notification after a fresh WS handshake. It serializes the Python-side
mirror (pipeline + frames + boxes) and pushes it back over a
``scene.apply_state`` RPC so the reloaded page can rebuild the same
scene the old page had.
"""

from __future__ import annotations

import threading
import time
from typing import Any

import molpy as mp
import numpy as np
import pytest

from molvis import Molvis
from molvis.commands import ModifierInfo


@pytest.fixture(autouse=True)
def _reset_registry() -> None:
    Molvis._scene_registry.clear()
    yield
    Molvis._scene_registry.clear()


def _capture_send_request(scene: Molvis) -> list[dict[str, Any]]:
    """Replace ``transport.send_request`` with a capture stub."""
    calls: list[dict[str, Any]] = []

    def stub(method, params, *, buffers=None, wait_for_response=False, timeout=10.0):
        calls.append({"method": method, "params": params})
        return None

    scene._transport.send_request = stub  # type: ignore[method-assign]
    return calls


def _water_frame() -> mp.Frame:
    atoms = {
        "element": np.array(["O", "H", "H"]),
        "x": np.array([0.0, 0.96, -0.24], dtype=np.float64),
        "y": np.array([0.0, 0.0, 0.93], dtype=np.float64),
        "z": np.array([0.0, 0.0, 0.0], dtype=np.float64),
    }
    return mp.Frame(blocks={"atoms": atoms})


def test_empty_payload_when_nothing_pushed() -> None:
    scene = Molvis(name="sync-empty")
    calls = _capture_send_request(scene)

    scene._send_state_sync_snapshot()

    assert len(calls) == 1
    assert calls[0]["method"] == "scene.apply_state"
    assert calls[0]["params"] == {
        "pipeline": [],
        "frames": None,
        "boxes": None,
    }


def test_payload_carries_pipeline_and_frames() -> None:
    scene = Molvis(name="sync-populated")
    scene._mirror_pipeline = [
        ModifierInfo(
            id="data-source-1",
            name="Data Source",
            category="data",
            enabled=True,
            selection_scope_id=None,
            source_owner_id=None,
        ),
        ModifierInfo(
            id="hide-h-2",
            name="Hide Hydrogens",
            category="Structure",
            enabled=False,
            selection_scope_id=None,
            source_owner_id=None,
        ),
    ]
    frame = _water_frame()
    scene._mirror_trajectory = [frame]
    scene._mirror_boxes = None
    calls = _capture_send_request(scene)

    scene._send_state_sync_snapshot()

    assert len(calls) == 1
    params = calls[0]["params"]
    assert [p["id"] for p in params["pipeline"]] == ["data-source-1", "hide-h-2"]
    assert params["pipeline"][1]["enabled"] is False
    assert isinstance(params["frames"], list) and len(params["frames"]) == 1
    assert "blocks" in params["frames"][0]
    assert params["boxes"] is None


def test_event_bus_dispatch_triggers_send(monkeypatch: pytest.MonkeyPatch) -> None:
    scene = Molvis(name="sync-event")
    scene._mirror_pipeline = [
        ModifierInfo(
            id="m1",
            name="Slice",
            category="Geometry",
            enabled=True,
            selection_scope_id=None,
            source_owner_id=None,
        )
    ]

    ready = threading.Event()
    captured: list[dict[str, Any]] = []

    def stub(method, params, *, buffers=None, wait_for_response=False, timeout=10.0):
        captured.append({"method": method, "params": params})
        ready.set()
        return None

    scene._transport.send_request = stub  # type: ignore[method-assign]

    # Dispatch the notification as the transport would when the frontend
    # pushes ``event.request_state_sync`` on a fresh WS handshake.
    scene._events.dispatch("event.request_state_sync", {})

    assert ready.wait(timeout=2.0), "state-sync handler did not fire"
    assert captured[0]["method"] == "scene.apply_state"
    assert [p["id"] for p in captured[0]["params"]["pipeline"]] == ["m1"]
