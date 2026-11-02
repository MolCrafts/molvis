"""Frame-bearing commands send and receive molrs Frame bytes, nothing else.

``send_cmd`` is stubbed; the router side is covered by the stage suite.
"""

from __future__ import annotations

from typing import Any

import molpy as mp
import numpy as np
import pytest
from molrs.io import read_msgpack_frame_bytes, write_msgpack_frame_bytes

from molvis import Molvis
from molvis.types import BinaryBufferRef


@pytest.fixture(autouse=True)
def _reset_registry():
    Molvis._scene_registry.clear()
    yield
    Molvis._scene_registry.clear()


def _stub_send_cmd(scene: Molvis, reply: Any = None) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def stub(method, params, buffers=None, wait_for_response=False, timeout=10.0):
        calls.append({"method": method, "params": params, "buffers": list(buffers or [])})
        return reply

    scene.send_cmd = stub  # type: ignore[method-assign]
    return calls


def _water() -> mp.Frame:
    frame = mp.Frame()
    frame["atoms"] = {
        "x": np.array([0.0, 0.96, -0.24]),
        "y": np.array([0.0, 0.0, 0.93]),
        "z": np.zeros(3),
        "element": np.array(["O", "H", "H"]),
    }
    return frame


class TestSetFrameLabels:
    def test_labels_travel_as_one_frame_with_a_labels_block(self) -> None:
        scene = Molvis(name="labels")
        calls = _stub_send_cmd(scene)

        scene.set_frame_labels({"energy": [1.5, 2.5], "temp": [300, 301]})

        assert calls[0]["params"] == {"labels": BinaryBufferRef(0).to_json()}
        labels = read_msgpack_frame_bytes(calls[0]["buffers"][0])["labels"]
        np.testing.assert_array_equal(labels["energy"], [1.5, 2.5])
        np.testing.assert_array_equal(labels["temp"], [300.0, 301.0])

    def test_none_clears_without_a_buffer(self) -> None:
        scene = Molvis(name="labels-none")
        calls = _stub_send_cmd(scene)

        scene.set_frame_labels(None)

        assert calls[0]["params"] == {"labels": None}
        assert calls[0]["buffers"] == []

    def test_rejects_a_2d_label(self) -> None:
        scene = Molvis(name="labels-2d")
        _stub_send_cmd(scene)
        with pytest.raises(ValueError, match="1D"):
            scene.set_frame_labels({"bad": [[1.0, 2.0]]})


class TestDrawBox:
    def test_box_travels_inside_a_frame(self) -> None:
        scene = Molvis(name="box")
        calls = _stub_send_cmd(scene)

        scene.draw_box(mp.Box(np.eye(3) * 10.0))

        assert calls[0]["method"] == "scene.draw_box"
        assert calls[0]["params"] == {"frame": BinaryBufferRef(0).to_json()}
        carrier = read_msgpack_frame_bytes(calls[0]["buffers"][0])
        assert carrier.box is not None
        assert carrier.box.volume() == pytest.approx(1000.0)


class TestFramesComingBack:
    def test_export_frame_reads_the_returned_bytes(self) -> None:
        scene = Molvis(name="export")
        _stub_send_cmd(scene, reply={"frame": write_msgpack_frame_bytes(_water())})

        frame = scene.export_frame()

        assert list(frame["atoms"].copy_column("element")) == ["O", "H", "H"]

    def test_get_selected_reads_the_returned_bytes(self) -> None:
        scene = Molvis(name="selected")
        _stub_send_cmd(scene, reply={"frame": write_msgpack_frame_bytes(_water())})

        frame = scene.get_selected()

        assert frame["atoms"].n_rows == 3

    def test_a_reply_without_frame_bytes_is_refused(self) -> None:
        scene = Molvis(name="export-bad")
        _stub_send_cmd(scene, reply={"frame": {"blocks": {}}})
        with pytest.raises(ValueError, match="export_frame"):
            scene.export_frame()
