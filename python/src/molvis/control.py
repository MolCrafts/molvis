"""
Programmatic control over a running MolVis viewer.

Provides camera manipulation, frame seeking, and snapshot capture for
scripting workflows: rotate the camera around a structure, walk through a
trajectory frame by frame, capture each as a PNG, then pipe the result into
ffmpeg via :mod:`molvis.video`.

Snapshots come from :class:`~molvis.commands.snapshot.SnapshotCommandsMixin`.
This mixin used to shadow that method with one targeting ``capture.snapshot``,
an RPC the frontend never implemented — so ``stage.snapshot()`` raised while a
working implementation sat unreachable further down the MRO.
"""

from __future__ import annotations

import math
import time
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .video import write_video as _write_video_t  # noqa: F401

__all__ = ["Camera", "CameraPose", "ControlMixin"]

Vec3 = tuple[float, float, float]

# Content seconds for one path lap when ``duration`` is infinite.
# ``rate`` still scales wall-clock (``rate=0.5`` → twice as long per lap).
_INF_CYCLE_CONTENT_S = 12.0


@dataclass(frozen=True)
class CameraPose:
    """Snapshot of an :class:`ArcRotateCamera` pose.

    Coordinates follow MolVis's Z-up convention. ``alpha`` is the azimuth in
    the XY plane; ``beta`` is the polar angle measured from +Z.
    """

    alpha: float
    beta: float
    radius: float
    target: tuple[float, float, float]
    position: tuple[float, float, float]
    up: tuple[float, float, float]

    @classmethod
    def from_rpc(cls, payload: dict[str, Any]) -> "CameraPose":
        return cls(
            alpha=float(payload["alpha"]),
            beta=float(payload["beta"]),
            radius=float(payload["radius"]),
            target=tuple(float(v) for v in payload["target"]),
            position=tuple(float(v) for v in payload["position"]),
            up=tuple(float(v) for v in payload["up"]),
        )


def _as_vec3(value: Sequence[float], *, label: str) -> Vec3:
    if len(value) < 3:
        raise ValueError(f"{label} must be a length-3 vector")
    return (float(value[0]), float(value[1]), float(value[2]))


def _lerp_vec3(a: Vec3, b: Vec3, t: float) -> Vec3:
    import numpy as np

    aa = np.asarray(a, dtype=float)
    bb = np.asarray(b, dtype=float)
    out = aa + (bb - aa) * float(t)
    return (float(out[0]), float(out[1]), float(out[2]))


def _normalize(v: Vec3) -> Vec3:
    import numpy as np

    arr = np.asarray(v, dtype=float)
    length = float(np.linalg.norm(arr))
    if length < 1e-12:
        return (0.0, 0.0, 1.0)
    out = arr / length
    return (float(out[0]), float(out[1]), float(out[2]))


def _slerp_vec3(a: Vec3, b: Vec3, t: float) -> Vec3:
    import numpy as np

    a_n = np.asarray(_normalize(a), dtype=float)
    b_n = np.asarray(_normalize(b), dtype=float)
    dot = float(np.clip(np.dot(a_n, b_n), -1.0, 1.0))
    if dot > 0.9995:
        return _normalize(_lerp_vec3(tuple(a_n), tuple(b_n), t))
    theta = float(np.arccos(dot))
    sin_theta = float(np.sin(theta))
    w0 = float(np.sin((1.0 - t) * theta) / sin_theta)
    w1 = float(np.sin(t * theta) / sin_theta)
    out = a_n * w0 + b_n * w1
    return _normalize((float(out[0]), float(out[1]), float(out[2])))


@dataclass(frozen=True)
class _Key:
    position: Vec3
    target: Vec3
    up: Vec3


def _parse_key(
    raw: Any,
    *,
    default_target: Vec3 | None,
    default_up: Vec3,
    index: int,
) -> _Key:
    """Accept a position triple, a mapping, or a :class:`CameraPose`."""
    if isinstance(raw, CameraPose):
        return _Key(position=raw.position, target=raw.target, up=raw.up)

    if isinstance(raw, Mapping):
        if "position" not in raw:
            raise TypeError(f"keypoints[{index}] mapping needs 'position'")
        position = _as_vec3(raw["position"], label=f"keypoints[{index}].position")
        if "target" in raw and raw["target"] is not None:
            target = _as_vec3(raw["target"], label=f"keypoints[{index}].target")
        elif default_target is not None:
            target = default_target
        else:
            raise TypeError(
                f"keypoints[{index}] has no target and no shared target= was given"
            )
        up = (
            _as_vec3(raw["up"], label=f"keypoints[{index}].up")
            if raw.get("up") is not None
            else default_up
        )
        return _Key(position=position, target=target, up=up)

    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
        position = _as_vec3(raw, label=f"keypoints[{index}]")
        if default_target is None:
            raise TypeError(
                "position-only keypoints require a shared target= look-at point"
            )
        return _Key(position=position, target=default_target, up=default_up)

    raise TypeError(
        f"keypoints[{index}] must be a position triple, mapping, or CameraPose; "
        f"got {type(raw)!r}"
    )


def _sample_keys(keys: Sequence[_Key], u: float) -> _Key:
    """Piecewise-linear sample on [0, 1] across ordered keypoints."""
    if u <= 0:
        return keys[0]
    if u >= 1:
        return keys[-1]
    nseg = len(keys) - 1
    x = u * nseg
    i = min(nseg - 1, int(x))
    local = x - i
    a, b = keys[i], keys[i + 1]
    return _Key(
        position=_lerp_vec3(a.position, b.position, local),
        target=_lerp_vec3(a.target, b.target, local),
        up=_slerp_vec3(a.up, b.up, local),
    )


def _pose_from_result(result: Any) -> CameraPose:
    """Accept either ``{pose: {...}}`` or a bare pose mapping."""
    if not isinstance(result, Mapping):
        raise TypeError(
            f"camera RPC returned {type(result)!r}, expected a mapping with pose fields"
        )
    if "pose" in result and isinstance(result["pose"], Mapping):
        return CameraPose.from_rpc(result["pose"])
    if "alpha" in result:
        return CameraPose.from_rpc(result)  # type: ignore[arg-type]
    raise TypeError(f"camera RPC result missing pose fields: keys={list(result)}")


def _is_infinite_duration(duration: float) -> bool:
    try:
        return math.isinf(float(duration))
    except (TypeError, ValueError):
        return False


class Camera:
    """Proxy that translates camera operations to RPC calls on a viewer.

    Mutating methods return ``self`` so camera calls chain::

        stage.camera.fit().set_pose(alpha=1.2).look_at(pos, tgt)

    Read the live pose via :attr:`pose` or :meth:`get_pose`.
    """

    def __init__(self, viewer: Any) -> None:
        self._viewer = viewer
        #: Modifier id of the last :meth:`track` install (if any).
        self._track_modifier_id: str | None = None

    def get_pose(self) -> CameraPose:
        """Query the live camera pose (does **not** return self — a read)."""
        result = self._viewer.send_cmd("camera.get_pose", {}, wait_for_response=True)
        # get_pose returns a bare pose mapping; set_pose/look_at wrap as {pose}.
        if isinstance(result, Mapping) and "alpha" in result and "pose" not in result:
            return CameraPose.from_rpc(result)
        return _pose_from_result(result)

    @property
    def pose(self) -> CameraPose:
        """Live camera pose — same as :meth:`get_pose`."""
        return self.get_pose()

    def set_pose(
        self,
        *,
        alpha: float | None = None,
        beta: float | None = None,
        radius: float | None = None,
        target: Sequence[float] | None = None,
    ) -> "Camera":
        params: dict[str, Any] = {}
        if alpha is not None:
            params["alpha"] = float(alpha)
        if beta is not None:
            params["beta"] = float(beta)
        if radius is not None:
            params["radius"] = float(radius)
        if target is not None:
            params["target"] = [float(v) for v in target]
        if not params:
            raise TypeError(
                "set_pose needs at least one of alpha, beta, radius, target"
            )
        self._viewer.send_cmd("camera.set_pose", params, wait_for_response=True)
        return self

    def look_at(
        self,
        position: Sequence[float],
        target: Sequence[float],
        up: Sequence[float] | None = None,
    ) -> "Camera":
        params: dict[str, Any] = {
            "position": [float(v) for v in position],
            "target": [float(v) for v in target],
        }
        if up is not None:
            params["up"] = [float(v) for v in up]
        self._viewer.send_cmd("camera.look_at", params, wait_for_response=True)
        return self

    def fit(self) -> "Camera":
        """Fit the camera to the current scene geometry. Returns ``self``."""
        self._viewer.send_cmd("camera.fit", {}, wait_for_response=True)
        return self

    def reset(self) -> "Camera":
        """Park at the empty-scene home pose. Returns ``self``."""
        self._viewer.send_cmd("camera.reset", {}, wait_for_response=True)
        return self

    def stop_track(self) -> "Camera":
        """Remove any **Camera track** pipeline modifier and stop motion.

        Same effect as deleting the step in the pipeline UI. Returns ``self``.
        """
        self._viewer.send_cmd("camera.stop_track", {}, wait_for_response=True)
        self._track_modifier_id = None
        # Refresh pipeline mirror when the host supports it.
        list_mod = getattr(self._viewer, "list_modifiers", None)
        if callable(list_mod):
            try:
                list_mod()
            except Exception:
                pass
        return self

    def track(
        self,
        keypoints: Sequence[Any],
        *,
        target: Sequence[float] | None = None,
        up: Sequence[float] | None = (0.0, 0.0, 1.0),
        duration: float = 4.0,
        rate: float = 1.0,
    ) -> Any:
        """Install a **Camera track** pipeline modifier and start playback.

        The path is driven on the frontend render loop (never blocks the
        kernel). A **Camera track** step appears in the pipeline UI; deleting
        or disabling it stops the motion. Calling :meth:`track` again replaces
        any previous camera-track step.

        Timing is two independent knobs (no sample-rate / fps coupling):

        * **duration** — content seconds for one lap (or one-shot path).
        * **rate** — pure speed multiplier. Wall-clock lap =
          ``duration / rate``. ``rate=2`` is twice as fast; ``rate=0.5`` is
          half speed. Independent of display refresh.

        Parameters
        ----------
        keypoints
            At least two entries. Each may be:

            * a position ``(x, y, z)`` — uses the shared ``target`` look-at
            * a mapping ``{"position": …, "target": …, "up": …}``
            * a :class:`CameraPose`
        target
            Shared look-at point when a key omits its own target. Required
            for bare position triples.
        up
            Default up vector (Z-up ``(0, 0, 1)``).
        duration
            Content seconds for one lap when finite. ``math.inf`` /
            ``numpy.inf`` → loop forever with a 12 s content cycle per lap
            (still scaled by ``rate`` only).
        rate
            Playback speed multiplier (``1.0`` = real-time content
            duration). Not a frame rate — do not pass ``fps``.

        Returns
        -------
        Camera
            ``self`` immediately (always non-blocking).

        Example
        -------
        ::

            stage.camera.fit()
            pose = stage.camera.pose
            t = np.asarray(pose.target)
            r = float(pose.radius)
            keys = [
                (t[0] + r, t[1], t[2] + 0.3 * r),
                (t[0], t[1] + r, t[2] + 0.3 * r),
                (t[0] - r, t[1], t[2] + 0.3 * r),
                (t[0], t[1] - r, t[2] + 0.3 * r),
                (t[0] + r, t[1], t[2] + 0.3 * r),
            ]
            # Slow infinite orbit: 12 s content lap at half speed → 24 s wall.
            stage.camera.track(keys, target=tuple(t), duration=np.inf, rate=0.5)
        """
        infinite = _is_infinite_duration(duration)
        if not infinite and float(duration) <= 0:
            raise ValueError("duration must be > 0 (or inf for a looping track)")
        if rate <= 0:
            raise ValueError("rate must be > 0")
        if len(keypoints) < 2:
            raise ValueError("track needs at least two keypoints")

        default_target = (
            _as_vec3(target, label="target") if target is not None else None
        )
        default_up = (
            _as_vec3(up, label="up") if up is not None else (0.0, 0.0, 1.0)
        )
        keys = [
            _parse_key(
                raw,
                default_target=default_target,
                default_up=default_up,
                index=i,
            )
            for i, raw in enumerate(keypoints)
        ]
        wire_keys = [
            {
                "position": list(k.position),
                "target": list(k.target),
                "up": list(k.up),
            }
            for k in keys
        ]
        cycle_s = _INF_CYCLE_CONTENT_S if infinite else float(duration)
        result = self._viewer.send_cmd(
            "camera.track",
            {
                "keys": wire_keys,
                "duration": cycle_s,
                "loop": infinite,
                "rate": float(rate),
            },
            wait_for_response=True,
        )
        if isinstance(result, Mapping):
            mid = result.get("id")
            self._track_modifier_id = str(mid) if mid is not None else None
        list_mod = getattr(self._viewer, "list_modifiers", None)
        if callable(list_mod):
            try:
                list_mod()
            except Exception:
                pass
        return self


def _png_bytes_from_response(response: Any) -> bytes:
    """Extract PNG bytes from a ``capture.snapshot`` response.

    The transport's ``BinaryPayloadDecoder`` resolves the ``png_ref``
    placeholder into a uint8 ndarray. We accept both the decoded ndarray
    and a raw bytes/bytearray fallback so the helper survives transport
    variations.
    """
    if isinstance(response, dict):
        ref = response.get("png_ref")
        if hasattr(ref, "tobytes"):
            return ref.tobytes()
        if isinstance(ref, (bytes, bytearray, memoryview)):
            return bytes(ref)
        # Some transports (older or fallback) may stuff base64 into a
        # 'data' field — handle gracefully.
        data = response.get("data")
        if isinstance(data, str):
            import base64

            payload = data.split(",", 1)[1] if "," in data else data
            return base64.b64decode(payload)
    if hasattr(response, "tobytes"):
        return response.tobytes()
    raise ValueError(
        f"Unexpected capture.snapshot response shape: {type(response).__name__}"
    )


class ControlMixin:
    """Camera, frame seeking, and snapshot ergonomics for any viewer that
    exposes :meth:`send_cmd` (Jupyter ``Molvis`` and ``StandaloneMolvis``).
    """

    @property
    def camera(self) -> Camera:
        proxy = getattr(self, "_camera_proxy", None)
        if proxy is None:
            proxy = Camera(self)
            self._camera_proxy = proxy  # type: ignore[attr-defined]
        return proxy

    def seek_frame(self, index: int) -> Any:
        """Move the trajectory to *index* (0-based) and redraw. Returns ``self``."""
        # String method name (not FrontendCommands) so this module stays free
        # of the commands package / molpy import graph — unit tests load it
        # without a matching molrs build.
        self.send_cmd(
            "scene.seek_frame",
            {"index": int(index)},
            wait_for_response=True,
        )
        return self

    def next_frame(self) -> Any:
        """Advance one frame, wrapping at the end. Returns ``self``."""
        state = self.refresh_state()
        return self.seek_frame((state.frame_index + 1) % max(state.total_frames, 1))

    def prev_frame(self) -> Any:
        """Step back one frame, wrapping at the start. Returns ``self``."""
        state = self.refresh_state()
        return self.seek_frame((state.frame_index - 1) % max(state.total_frames, 1))

    def frame_info(self) -> dict[str, int]:
        """Current frame index and trajectory length (query — not chainable)."""
        state = self.refresh_state()
        return {"index": state.frame_index, "total": state.total_frames}

    @property
    def n_frames(self) -> int:
        return int(self.refresh_state().total_frames)

    def render_animation(
        self,
        out_path: str | Path,
        *,
        frame_indices: Sequence[int] | None = None,
        camera_path: Sequence[CameraPose | None] | None = None,
        fps: int = 30,
        **video_kwargs: Any,
    ) -> Path:
        """Drive a seek + pose + snapshot loop and pipe results to ffmpeg.

        ``frame_indices`` defaults to every frame in the current trajectory;
        ``camera_path`` may be ``None`` (no per-frame pose change) or a
        sequence of poses with the same length as ``frame_indices``.
        """
        from .video import write_video

        indices: Sequence[int]
        if frame_indices is None:
            indices = range(self.n_frames)
        else:
            indices = frame_indices
        indices = list(indices)

        poses: list[CameraPose | None]
        if camera_path is None:
            poses = [None] * len(indices)
        else:
            poses = list(camera_path)
        if len(indices) != len(poses):
            raise ValueError("frame_indices and camera_path must have the same length")

        def _stream() -> Iterable[bytes]:
            for idx, pose in zip(indices, poses):
                if pose is not None:
                    self.camera.set_pose(
                        alpha=pose.alpha,
                        beta=pose.beta,
                        radius=pose.radius,
                        target=pose.target,
                    )  # returns Camera; chain stops here by design
                # Seek then capture: `snapshot.take` renders whatever is on
                # screen, so the seek has to be its own round-trip. The old
                # combined `frame_index=` argument belonged to `capture.snapshot`,
                # which the frontend never implemented.
                self.seek_frame(int(idx))
                yield self.snapshot()

        return write_video(_stream(), out_path, fps=fps, **video_kwargs)
