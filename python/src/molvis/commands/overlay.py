"""Atom-marker overlay commands for MolVis.

The 3-D annotation family (arrows, labels, vector fields) lived here as
``overlay.add`` / ``overlay.remove`` / ``overlay.update`` / ``overlay.clear``.
The frontend never implemented a handler for any of them, and because those
calls did not wait for a response they failed **silently** — the viewer simply
did nothing. They are removed rather than left as an API that lies; the parity
gate in ``tests/test_wire_parity.py`` now prevents a method from being declared
here without a handler on the other side.

A vector field in particular should not come back as an overlay payload of
flattened Python lists: per-atom vectors are Frame columns, and belong in the
atoms block alongside the coordinates they annotate.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import TYPE_CHECKING

from .catalog import FrontendCommands

if TYPE_CHECKING:
    from ..scene import Molvis

Vec3 = Sequence[float]

logger = logging.getLogger("molvis")

__all__ = ["OverlayCommandsMixin"]


class OverlayCommandsMixin:
    """Atom-marker overlays for :class:`~molvis.scene.Molvis`."""

    def mark_atom(
        self: "Molvis",
        atom_id: int,
        *,
        label: str | None = None,
        shape_color: str | None = None,
        shape_opacity: float | None = None,
        show_shape: bool = True,
        label_color: str | None = None,
        label_background: str | None = None,
        label_offset: Vec3 | None = None,
        name: str | None = None,
        wait_for_response: bool = False,
    ) -> "Molvis":
        """
        Mark an atom with a halo and/or text label.

        The mark is anchored to ``atom_id`` and follows that atom across
        frame updates. Halo radius and label font size are auto-sized from
        the atom's rendered radius on the frontend — pass style overrides
        only when you want to deviate from that.

        Args:
            atom_id: Atom index to mark. Must exist in the current frame.
            label: Optional text to display next to the mark.
            shape_color: CSS hex color for the halo (default amber).
            shape_opacity: Halo opacity in 0-1 (default 0.35).
            show_shape: Set ``False`` to display only the label, no halo.
            label_color: CSS color for the label text.
            label_background: Fill color behind the label, or ``None``.
            label_offset: ``[dx, dy, dz]`` offset of the label from center.
            name: Optional display name for the overlay.
            wait_for_response: When ``True``, block until the frontend
                returns the new overlay id; the id is stored on
                ``self.last_mark_id``.

        Returns:
            ``self`` for method chaining.
        """
        params: dict = {"anchorAtomId": atom_id}
        if name is not None:
            params["name"] = name

        if not show_shape:
            params["shape"] = None
        elif shape_color is not None or shape_opacity is not None:
            shape: dict = {}
            if shape_color is not None:
                shape["color"] = shape_color
            if shape_opacity is not None:
                shape["opacity"] = shape_opacity
            params["shape"] = shape

        if label is not None:
            label_props: dict = {"text": label}
            if label_color is not None:
                label_props["color"] = label_color
            if label_background is not None:
                label_props["background"] = label_background
            if label_offset is not None:
                label_props["offset"] = list(label_offset)
            params["label"] = label_props

        result = self.send_cmd(
            FrontendCommands.MARK_ATOM.method,
            params,
            wait_for_response=wait_for_response,
        )
        if wait_for_response and isinstance(result, dict):
            self.last_mark_id = str(result.get("id", ""))  # type: ignore[attr-defined]
        return self

    def unmark_atom(self: "Molvis", overlay_id: str) -> "Molvis":
        """
        Remove a mark by id.

        Args:
            overlay_id: The id from a prior ``mark_atom(..., wait_for_response=True)``
                (also available as ``stage.last_mark_id``).

        Returns:
            ``self`` for method chaining.
        """
        self.send_cmd(
            FrontendCommands.UNMARK_ATOM.method,
            {"id": overlay_id},
        )
        return self
