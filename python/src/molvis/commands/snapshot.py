"""
Snapshot commands for MolVis.
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from .catalog import FrontendCommands

if TYPE_CHECKING:
    from ..scene import Molvis

logger = logging.getLogger("molvis")

__all__ = ["Capture", "SnapshotCommandsMixin"]


@dataclass(frozen=True)
class Capture:
    """A snapshot and how canvas pixels map into it.

    Attributes:
        png: The PNG bytes.
        scale: PNG pixels per canvas CSS pixel.
        crop: ``(x, y, width, height)`` of the full render the crop kept, in
            PNG pixels; ``None`` when uncropped.
    """

    png: bytes
    scale: float
    crop: tuple[int, int, int, int] | None

    def to_image(self, x: float, y: float) -> tuple[float, float]:
        """A canvas point (CSS px, e.g. from ``camera.project``) in PNG pixels."""
        ox, oy = (self.crop[0], self.crop[1]) if self.crop else (0, 0)
        return (x * self.scale - ox, y * self.scale - oy)


class SnapshotCommandsMixin:
    """Mixin class providing snapshot commands for Molvis widget."""

    def snapshot(
        self: Molvis,
        timeout: float = 5.0,
        *,
        scale: float = 1.0,
        transparent: bool = False,
        axes: bool = True,
        crop_margin: int | None = None,
    ) -> bytes:
        """Take a snapshot of the current view as PNG bytes.

        The PNG of :meth:`capture`; see there for the arguments.
        """
        return self.capture(
            timeout,
            scale=scale,
            transparent=transparent,
            axes=axes,
            crop_margin=crop_margin,
        ).png

    def capture(
        self: Molvis,
        timeout: float = 5.0,
        *,
        scale: float = 1.0,
        transparent: bool = False,
        axes: bool = True,
        crop_margin: int | None = None,
    ) -> Capture:
        """Take a snapshot of the current view, with its pixel mapping.

        Every command sent before this call is applied first, fire-and-forget
        ones included. The default captures the canvas as shown, axis gizmo
        included. ``axes=False`` renders the molecular scene again offscreen,
        multisampled, at ``scale`` times the canvas size, which is what a
        figure wants; ``transparent`` clears the background, and
        ``crop_margin`` trims the image to its content plus that many pixels
        (a cropped snapshot is transparent).

        Args:
            timeout: Maximum time to wait for the response, in seconds.
            scale: Output size as a multiple of the canvas size; needs
                ``axes=False`` unless it is 1.
            transparent: Transparent background; needs ``axes=False``.
            axes: Draw the axis gizmo (default ``True``).
            crop_margin: Crop to the content with this margin in output
                pixels; needs ``axes=False``.

        Raises:
            TimeoutError: If the frontend does not respond within the timeout
            molvis.MolvisRPCError: If the frontend rejects the options or the
                snapshot request
        """
        params: dict[str, object] = {"scale": float(scale), "axes": bool(axes)}
        if transparent:
            params["transparent"] = True
        if crop_margin is not None:
            params["crop_margin"] = int(crop_margin)
        data = self.send_cmd(
            FrontendCommands.SNAPSHOT.method,
            params,
            wait_for_response=True,
            timeout=timeout,
        )
        if not isinstance(data, dict) or "data" not in data:
            raise ValueError(f"Unexpected response format from take_snapshot: {data}")
        base64_str = data["data"]
        # Remove header if present (e.g. "data:image/png;base64,")
        if "," in base64_str:
            base64_str = base64_str.split(",", 1)[1]
        crop = data.get("crop")
        return Capture(
            png=base64.b64decode(base64_str),
            scale=float(data.get("scale", scale)),
            crop=(
                (int(crop["x"]), int(crop["y"]), int(crop["width"]), int(crop["height"]))
                if crop
                else None
            ),
        )
