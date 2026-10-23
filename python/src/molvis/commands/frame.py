"""Frame I/O commands for MolVis."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from pathlib import Path
from typing import TYPE_CHECKING, Any

import molpy as mp
import numpy as np
from molrs.io import read_msgpack_frame_bytes, write_msgpack_frame_bytes

from ..structure import frame_arg, frames_arg
from ..types import BinaryBufferRef
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
    def set_trajectory(
        self: "Molvis",
        frames: list[Any],
        *,
        wait: bool = False,
    ) -> "Molvis":
        """Replace the viewer's trajectory.

        Each frame carries its own box (``frame.box``). The old parallel
        ``boxes=`` argument is gone: it was never length-checked against
        ``frames``, so a short list silently left later frames unboxed.

        Fire-and-forget by default. Pass ``wait=True`` to block on the
        frontend ACK and refresh the local modifier pipeline mirror.
        """
        # One buffer of molrs Frame bytes per frame; the JSON carries refs.
        buffers = [write_msgpack_frame_bytes(frame) for frame in frames]
        self.send_cmd(
            FrontendCommands.SET_TRAJECTORY.method,
            {"frames": [BinaryBufferRef(i).to_json() for i in range(len(buffers))]},
            buffers=buffers,
            wait_for_response=wait,
        )

        self._record_trajectory(buffers)
        if wait:
            self.list_modifiers()
        return self

    @frame_arg
    def add_data_source(
        self: "Molvis",
        frame: Any,
        *,
        filename: str | None = None,
        wait: bool = True,
    ) -> "Molvis":
        """Stack a length-1 source onto the scene (topology overlay).

        The same composition as dropping a LAMMPS data file onto a
        trajectory: identity and bonds from this frame broadcast across
        the current timeline.
        """
        self.send_cmd(
            FrontendCommands.ADD_DATA_SOURCE.method,
            {"frame": BinaryBufferRef(0).to_json(), "filename": filename},
            buffers=[write_msgpack_frame_bytes(frame)],
            wait_for_response=wait,
        )
        return self

    def add_mesh(
        self: "Molvis",
        path: str | Path,
        *,
        wait: bool = True,
    ) -> "Molvis":
        """Load an STL packing container as view geometry, not a data source."""
        file_path = Path(path)
        data = file_path.read_bytes()
        self.send_cmd(
            FrontendCommands.ADD_MESH_OVERLAY.method,
            {"filename": file_path.name},
            buffers=[data],
            wait_for_response=wait,
        )
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
        self.send_cmd(
            FrontendCommands.APPEND_FRAME.method,
            {"frame": BinaryBufferRef(0).to_json(), "follow": bool(follow)},
            buffers=[write_msgpack_frame_bytes(frame)],
            wait_for_response=wait_for_response,
        )
        return self

    def set_frame_labels(
        self: "Molvis",
        labels: Mapping[str, Any] | None,
    ) -> "Molvis":
        """Attach per-frame numeric descriptors, one value per frame.

        The labels travel as one molrs Frame whose ``labels`` block holds one
        float64 column per descriptor — the same bytes any Frame crosses the
        seam in. Values stay float64 end to end: the frontend stores them with
        molrs ``setMetaScalar`` rather than round-tripping them through decimal
        text.
        """
        if labels is None:
            self.send_cmd(FrontendCommands.SET_FRAME_LABELS.method, {"labels": None})
            return self

        columns: dict[str, np.ndarray] = {}
        for name, values in labels.items():
            array = np.asarray(values, dtype=np.float64)
            if array.ndim != 1:
                raise ValueError(
                    f"labels['{name}'] must be 1D, got shape {array.shape}"
                )
            columns[str(name)] = array
        frame = mp.Frame()
        frame["labels"] = columns

        self.send_cmd(
            FrontendCommands.SET_FRAME_LABELS.method,
            {"labels": BinaryBufferRef(0).to_json()},
            buffers=[write_msgpack_frame_bytes(frame)],
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
        if not isinstance(data, Mapping) or not isinstance(data.get("frame"), bytes):
            raise ValueError(f"Unexpected response from export_frame: {data!r}")
        return read_msgpack_frame_bytes(data["frame"])
