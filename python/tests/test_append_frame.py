"""Unit tests for ``Molvis.append_frame`` — the streaming ingress.

``send_cmd`` is stubbed; the router side is covered by the stage suite. What
matters here is the payload shape, the defaults a producer relies on, and the
bound on the reconnect mirror.
"""

from __future__ import annotations

from typing import Any

import molpy as mp
import numpy as np
import pytest

from molvis import Molvis
from molvis.commands.catalog import FrontendCommands, rpc_method_names
from molvis.wire import BUFFER_REF_MARKER


@pytest.fixture(autouse=True)
def _reset_registry():
    Molvis._scene_registry.clear()
    yield
    Molvis._scene_registry.clear()


def _frame(offset: float = 0.0) -> mp.Frame:
    return mp.Frame(
        blocks={
            "atoms": {
                "x": np.array([0.0, 1.0, -1.0]) + offset,
                "y": np.zeros(3),
                "z": np.zeros(3),
                "element": ["O", "H", "H"],
            }
        }
    )


def _wire_send_cmd(scene: Molvis) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def stub(method, params, buffers=None, wait_for_response=False, timeout=10.0):
        calls.append(
            {
                "method": method,
                "params": params,
                "buffers": list(buffers or []),
                "wait_for_response": wait_for_response,
            }
        )
        return {}

    scene.send_cmd = stub  # type: ignore[method-assign]
    return calls


def test_append_frame_is_in_the_catalog() -> None:
    assert FrontendCommands.APPEND_FRAME.method == "scene.append_frame"
    assert "scene.append_frame" in rpc_method_names()


def test_sends_one_frame_not_a_trajectory() -> None:
    # The whole point: streaming through set_trajectory resends the run so far
    # on every step.
    scene = Molvis(name="append-one")
    calls = _wire_send_cmd(scene)

    scene.append_frame(_frame())

    assert len(calls) == 1
    assert calls[0]["method"] == "scene.append_frame"
    assert "frame" in calls[0]["params"]
    assert "frames" not in calls[0]["params"]


def test_columns_travel_as_binary_buffers() -> None:
    scene = Molvis(name="append-buffers")
    calls = _wire_send_cmd(scene)

    scene.append_frame(_frame())

    columns = calls[0]["params"]["frame"]["blocks"]["atoms"]["columns"]
    assert columns["x"]["data"][BUFFER_REF_MARKER] is True
    assert columns["element"]["dtype"] == "string"
    assert len(calls[0]["buffers"]) == 3  # x, y, z


def test_follows_the_tail_by_default() -> None:
    scene = Molvis(name="append-follow")
    calls = _wire_send_cmd(scene)

    scene.append_frame(_frame())

    assert calls[0]["params"]["follow"] is True


def test_follow_false_is_forwarded() -> None:
    scene = Molvis(name="append-nofollow")
    calls = _wire_send_cmd(scene)

    scene.append_frame(_frame(), follow=False)

    assert calls[0]["params"]["follow"] is False


def test_does_not_wait_for_a_response_by_default() -> None:
    # A producer at 100 Hz cannot pay a browser round trip per step.
    scene = Molvis(name="append-nowait")
    calls = _wire_send_cmd(scene)

    scene.append_frame(_frame())

    assert calls[0]["wait_for_response"] is False


def test_wait_for_response_is_opt_in() -> None:
    scene = Molvis(name="append-wait")
    calls = _wire_send_cmd(scene)

    scene.append_frame(_frame(), wait_for_response=True)

    assert calls[0]["wait_for_response"] is True


def test_returns_self_for_chaining() -> None:
    scene = Molvis(name="append-chain")
    _wire_send_cmd(scene)

    assert scene.append_frame(_frame()) is scene


def test_accepts_the_same_structures_set_trajectory_does() -> None:
    # `frame_arg` coercion, not a Frame-only path: whatever `set_trajectory`
    # takes per element, `append_frame` takes one of.
    scene = Molvis(name="append-coerce")
    calls = _wire_send_cmd(scene)

    graph = mp.Atomistic()
    graph.def_atom(x=0.0, y=0.0, z=0.0, element="C")
    graph.def_atom(x=1.5, y=0.0, z=0.0, element="O")
    scene.append_frame(graph)

    assert calls[0]["method"] == "scene.append_frame"
    columns = calls[0]["params"]["frame"]["blocks"]["atoms"]["columns"]
    assert set(columns) >= {"x", "y", "z", "element"}


class TestReconnectMirror:
    """Streamed frames stay out of the mirror — see `append_frame`'s note."""

    def test_streaming_does_not_grow_the_mirror(self) -> None:
        # Mirroring a live run would hold every frame in Python memory and
        # re-serialize all of them on each page reload.
        scene = Molvis(name="mirror-nogrow")
        _wire_send_cmd(scene)

        for _ in range(1000):
            scene.append_frame(_frame())

        assert scene._mirror_trajectory is None

    def test_streaming_does_not_disturb_a_mirrored_trajectory(self) -> None:
        # A scene loaded with set_trajectory and then streamed into still
        # re-syncs the loaded trajectory.
        scene = Molvis(name="mirror-keep")
        _wire_send_cmd(scene)

        scene.set_trajectory([_frame(), _frame()])
        scene.append_frame(_frame())

        assert len(scene._mirror_trajectory or []) == 2

    def test_state_sync_snapshot_still_builds_after_streaming(self) -> None:
        scene = Molvis(name="mirror-payload")
        _wire_send_cmd(scene)
        scene.set_trajectory([_frame()])
        scene.append_frame(_frame())

        payload, buffers = scene._build_state_payload()

        assert payload["frames"] is not None
        assert len(payload["frames"]) == 1
        assert len(buffers) == 3  # x, y, z of the one mirrored frame
