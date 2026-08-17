from __future__ import annotations

import importlib
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np


def import_control_module():
    """Import molvis.control.

    This used to load control.py by path behind a hand-built stub package,
    to dodge molvis/__init__ pulling molpy/molrs. Both are ordinary declared
    dependencies now, and the stub was actively harmful: when this module was
    imported before anything had imported the real `molvis`, it left a fake
    one in sys.modules and every later `from molvis import ...` in the suite
    failed with "unknown location".
    """
    return importlib.import_module("molvis.control")


class FakeViewer:
    """Captures send_cmd calls and returns scripted responses."""

    def __init__(self, responses: dict[str, Any] | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.responses = responses or {}

    def send_cmd(
        self,
        method: str,
        params: dict[str, Any],
        buffers: list[Any] | None = None,
        wait_for_response: bool = False,
        timeout: float = 10.0,
    ) -> Any:
        self.calls.append(
            {
                "method": method,
                "params": params,
                "wait_for_response": wait_for_response,
                "timeout": timeout,
            }
        )
        if method in self.responses:
            response = self.responses[method]
            if callable(response):
                return response(params)
            return response
        return None


def test_camera_get_pose_returns_dataclass():
    control = import_control_module()
    viewer = FakeViewer(
        responses={
            "camera.get_pose": {
                "alpha": 1.0,
                "beta": 0.5,
                "radius": 12.0,
                "target": [1.0, 2.0, 3.0],
                "position": [4.0, 5.0, 6.0],
                "up": [0.0, 0.0, 1.0],
            }
        }
    )

    cam = control.Camera(viewer)
    pose = cam.get_pose()

    assert isinstance(pose, control.CameraPose)
    assert pose.alpha == 1.0
    assert pose.target == (1.0, 2.0, 3.0)
    assert viewer.calls[0]["method"] == "camera.get_pose"
    assert viewer.calls[0]["wait_for_response"] is True


def test_camera_set_pose_omits_unset_fields():
    control = import_control_module()
    viewer = FakeViewer(
        responses={
            "camera.set_pose": {
                "success": True,
                "pose": {
                    "alpha": 1.5,
                    "beta": 0.5,
                    "radius": 10.0,
                    "target": [0.0, 0.0, 0.0],
                    "position": [10.0, 0.0, 0.0],
                    "up": [0.0, 0.0, 1.0],
                },
            }
        }
    )

    cam = control.Camera(viewer)
    out = cam.set_pose(alpha=1.5, target=(0.0, 0.0, 0.0))
    assert out is cam

    sent = viewer.calls[0]["params"]
    assert sent == {"alpha": 1.5, "target": [0.0, 0.0, 0.0]}
    assert "beta" not in sent
    assert "radius" not in sent


def test_camera_look_at_serializes_vectors():
    control = import_control_module()
    viewer = FakeViewer(
        responses={
            "camera.look_at": {
                "success": True,
                "pose": {
                    "alpha": 0.0,
                    "beta": 1.5,
                    "radius": 10.0,
                    "target": [0.0, 0.0, 0.0],
                    "position": [10.0, 0.0, 0.0],
                    "up": [0.0, 0.0, 1.0],
                },
            }
        }
    )

    cam = control.Camera(viewer)
    out = cam.look_at(position=(10, 0, 0), target=(0, 0, 0), up=(0, 0, 1))
    assert out is cam

    sent = viewer.calls[0]["params"]
    assert sent["position"] == [10.0, 0.0, 0.0]
    assert sent["target"] == [0.0, 0.0, 0.0]
    assert sent["up"] == [0.0, 0.0, 1.0]


def test_control_mixin_seek_frame_passes_index():
    control = import_control_module()
    viewer = FakeViewer(responses={"scene.seek_frame": {"current": 5, "total": 100}})

    class Host(control.ControlMixin, FakeViewer):
        pass

    host = Host(responses=viewer.responses)
    result = host.seek_frame(5)

    assert result is host
    assert host.calls[0]["method"] == "scene.seek_frame"
    assert host.calls[0]["params"] == {"index": 5}


def test_control_mixin_n_frames_reads_viewer_state():
    """`n_frames` comes from the state snapshot, not a `frame.info` RPC."""
    control = import_control_module()

    class Host(control.ControlMixin, FakeViewer):
        def refresh_state(self, *, timeout: float = 10.0):
            return SimpleNamespace(frame_index=3, total_frames=100)

    assert Host().n_frames == 100


def test_render_animation_orchestrates_seek_pose_snapshot(tmp_path: Path, monkeypatch):
    control = import_control_module()
    png_bytes = b"\x89PNG\r\n\x1a\nFRAME"

    class Host(control.ControlMixin, FakeViewer):
        def snapshot(self, timeout: float = 5.0) -> bytes:
            return png_bytes

    pose_response = {
        "success": True,
        "pose": {
            "alpha": 0.0,
            "beta": 1.0,
            "radius": 10.0,
            "target": [0.0, 0.0, 0.0],
            "position": [10.0, 0.0, 0.0],
            "up": [0.0, 0.0, 1.0],
        },
    }
    host = Host(
        responses={
            "scene.seek_frame": {"index": 0, "total": 3},
            "camera.set_pose": pose_response,
        }
    )

    captured: dict[str, Any] = {}

    def fake_write_video(frames, path, **kwargs):
        captured["frames"] = list(frames)
        captured["path"] = path
        captured["kwargs"] = kwargs
        return Path(path)

    import molvis.video as video_mod

    monkeypatch.setattr(video_mod, "write_video", fake_write_video)

    poses = [
        control.CameraPose(
            alpha=float(i),
            beta=1.0,
            radius=10.0,
            target=(0.0, 0.0, 0.0),
            position=(10.0, 0.0, 0.0),
            up=(0.0, 0.0, 1.0),
        )
        for i in range(3)
    ]

    out = host.render_animation(
        tmp_path / "out.mp4",
        frame_indices=[0, 1, 2],
        camera_path=poses,
        fps=24,
    )

    assert out == tmp_path / "out.mp4"
    assert len(captured["frames"]) == 3
    assert all(f == png_bytes for f in captured["frames"])
    assert captured["kwargs"]["fps"] == 24

    methods = [c["method"] for c in host.calls]
    assert methods.count("camera.set_pose") == 3
    # Seek is its own round-trip now; the capture itself is snapshot.take.
    assert methods.count("scene.seek_frame") == 3


def test_render_animation_rejects_mismatched_lengths():
    control = import_control_module()

    class Host(control.ControlMixin, FakeViewer):
        pass

    host = Host(responses={"frame.info": {"current": 0, "total": 2}})

    import pytest

    with pytest.raises(ValueError, match="same length"):
        host.render_animation(
            "out.mp4", frame_indices=[0, 1, 2], camera_path=[None, None]
        )


def test_camera_track_sends_pipeline_modifier_rpc():
    """track() installs a Camera track modifier via camera.track RPC."""
    control = import_control_module()
    viewer = FakeViewer(
        responses={
            "camera.track": {
                "id": "alpha-1",
                "playing": True,
                "modifier": {"id": "alpha-1", "name": "Camera track"},
            }
        }
    )
    cam = control.Camera(viewer)
    final = cam.track(
        [(10, 0, 0), (0, 10, 0), (-10, 0, 0)],
        target=(0, 0, 0),
        duration=4.0,
        rate=1.0,
    )
    assert final is cam
    track_calls = [c for c in viewer.calls if c["method"] == "camera.track"]
    assert len(track_calls) == 1
    params = track_calls[0]["params"]
    assert params["loop"] is False
    assert params["duration"] == 4.0
    assert params["rate"] == 1.0
    assert len(params["keys"]) == 3
    assert params["keys"][0]["position"] == [10.0, 0.0, 0.0]
    assert params["keys"][0]["target"] == [0.0, 0.0, 0.0]
    assert cam._track_modifier_id == "alpha-1"


def test_camera_track_inf_loops_with_default_cycle():
    """duration=inf → loop=True and 12s content cycle."""
    control = import_control_module()
    viewer = FakeViewer(
        responses={"camera.track": {"id": "bravo-1", "playing": True}}
    )
    cam = control.Camera(viewer)
    cam.track(
        [(10, 0, 0), (0, 10, 0)],
        target=(0, 0, 0),
        duration=np.inf,
        rate=0.5,
    )
    params = [c for c in viewer.calls if c["method"] == "camera.track"][0][
        "params"
    ]
    assert params["loop"] is True
    assert params["duration"] == 12.0
    assert params["rate"] == 0.5


def test_camera_stop_track_sends_rpc():
    control = import_control_module()
    viewer = FakeViewer(responses={"camera.stop_track": {"removed_ids": ["x"]}})
    cam = control.Camera(viewer)
    cam._track_modifier_id = "x"
    assert cam.stop_track() is cam
    assert any(c["method"] == "camera.stop_track" for c in viewer.calls)
    assert cam._track_modifier_id is None


def test_camera_track_inf_accepts_math_inf():
    control = import_control_module()
    import math

    viewer = FakeViewer(responses={"camera.track": {"id": "c-1"}})
    cam = control.Camera(viewer)
    assert (
        cam.track([(1, 0, 0), (0, 1, 0)], target=(0, 0, 0), duration=math.inf)
        is cam
    )


def test_camera_set_pose_requires_at_least_one_field():
    control = import_control_module()
    cam = control.Camera(FakeViewer())
    import pytest

    with pytest.raises(TypeError, match="at least one"):
        cam.set_pose()
