"""Frame I/O commands for MolVis."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

import molpy as mp
import numpy as np

from ..structure import frame_arg, frame_payload, frames_arg
from ..wire import decode_frame, encode_frame
from .catalog import FrontendCommands

if TYPE_CHECKING:
    from ..scene import Molvis

logger = logging.getLogger("molvis")

__all__ = ["FrameCommandsMixin"]


class FrameCommandsMixin:
    """Frame I/O — trajectory / labels / export.

    Structure-bearing methods take frames as the **first** argument after
    ``self``. :func:`~molvis.structure.frames_arg` coerces each element.
    """

    @frames_arg
    def set_trajectory(self: "Molvis", frames: list[Any]) -> "Molvis":
        """Replace the viewer's trajectory.

        Each frame carries its own box (``frame.box``). The old parallel
        ``boxes=`` argument is gone: it was never length-checked against
        ``frames``, so a short list silently left later frames unboxed.
        """
        payloads: list[dict[str, Any]] = []
        buffers: list[Any] = []
        for frame in frames:
            # Buffer indices are per-message, so re-base each frame's refs onto
            # the running list as it grows.
            payload, frame_buffers = frame_payload(frame)
            payloads.append(_rebase_buffer_refs(payload, len(buffers)))
            buffers.extend(frame_buffers)

        self.send_cmd(
            FrontendCommands.SET_TRAJECTORY.method,
            {"frames": payloads},
            buffers=buffers,
            wait_for_response=True,
        )

        self._record_trajectory(frames)
        self.list_modifiers()
        return self

    @frame_arg
    def append_frame(
        self: "Molvis",
        frame: Any,
        *,
        follow: bool = True,
        wait_for_response: bool = False,
    ) -> "Molvis":
        """Append one frame to the end of the viewer's trajectory.

        The streaming ingress. :meth:`set_trajectory` replaces the whole
        trajectory and forces a full pipeline rebuild plus a camera re-fit, so
        driving a running simulation through it costs O(N²) bytes and rebuilds
        the scene every step. This sends one frame, rebuilds nothing, and moves
        the camera only on the frame that creates the scene.

        Args:
            frame: A :class:`molpy.Frame`, ``Atomistic``, or molgraph — the same
                inputs :meth:`set_trajectory` accepts, one at a time.
            follow: Advance the viewer to the new frame (default). Pass
                ``False`` to leave the playhead wherever the user parked it
                while frames keep arriving.
            wait_for_response: Block until the browser acknowledges. Off by
                default — a producer at high rate should not pay a round trip
                per step. Turn it on when you need back-pressure, or when a
                dropped frame would be a bug rather than a skipped redraw.

        Returns:
            ``self``, for chaining.

        Note:
            Streamed frames are **not** kept in the reconnect mirror, unlike
            :meth:`set_trajectory`. Retaining them would hold the whole run in
            Python memory and re-serialize it on every page reload, and the
            frames are thread-bound (a relay decodes them off the main thread),
            so the mirror could not safely outlive the producer. A browser that
            reloads mid-stream therefore shows whatever the last
            ``set_trajectory`` / draw established until the next frame arrives
            — which, for a live stream, is the next step.
        """
        payload, buffers = frame_payload(frame)
        self.send_cmd(
            FrontendCommands.APPEND_FRAME.method,
            {"frame": payload, "follow": bool(follow)},
            buffers=buffers,
            wait_for_response=wait_for_response,
        )
        return self

    def set_frame_labels(
        self: "Molvis",
        labels: Mapping[str, Any] | None,
    ) -> "Molvis":
        """Attach per-frame numeric descriptors, one value per frame.

        Values stay float64 end to end — the frontend stores them with molrs
        ``setMetaScalar`` rather than round-tripping them through decimal text.
        """
        if labels is None:
            self.send_cmd(FrontendCommands.SET_FRAME_LABELS.method, {"labels": None})
            return self

        columns: dict[str, Any] = {}
        buffers: list[Any] = []
        for name, values in labels.items():
            array = np.asarray(values, dtype=np.float64)
            if array.ndim != 1:
                raise ValueError(
                    f"labels['{name}'] must be 1D, got shape {array.shape}"
                )
            # One f64 wire column, the same shape any Frame column has.
            payload, column_buffers = encode_frame(
                {"blocks": {"labels": {name: array}}}
            )
            columns[name] = _rebase_buffer_refs(
                payload["blocks"]["labels"]["columns"][name], len(buffers)
            )
            buffers.extend(column_buffers)

        self.send_cmd(
            FrontendCommands.SET_FRAME_LABELS.method,
            {"labels": columns},
            buffers=buffers,
        )
        return self

    def export_frame(self: "Molvis", timeout: float = 5.0) -> mp.Frame:
        """Export the current staged scene as a :class:`molpy.Frame`.

        Every block and column the scene holds comes back, not a fixed
        ``{x, y, z, element}`` subset.
        """
        data = self.send_cmd(
            FrontendCommands.EXPORT_FRAME.method,
            {},
            wait_for_response=True,
            timeout=timeout,
        )
        if not isinstance(data, Mapping) or "frame" not in data:
            raise ValueError(f"Unexpected response from export_frame: {data!r}")
        return decode_frame(data["frame"])


def _rebase_buffer_refs(payload: Any, offset: int) -> Any:
    """Shift every buffer-reference index in *payload* by *offset*.

    Each frame is encoded independently, so its references start at zero; a
    message carrying several frames concatenates their buffers and needs the
    indices renumbered to match.
    """
    from ..wire import BUFFER_REF_MARKER

    if isinstance(payload, Mapping):
        if payload.get(BUFFER_REF_MARKER) is True:
            return {**payload, "index": int(payload["index"]) + offset}
        return {
            key: _rebase_buffer_refs(value, offset) for key, value in payload.items()
        }
    if isinstance(payload, list):
        return [_rebase_buffer_refs(item, offset) for item in payload]
    return payload
