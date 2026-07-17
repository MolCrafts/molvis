"""Drawing and visualization commands for MolVis widget."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Literal

import molpy as mp
import numpy as np

from .catalog import FrontendCommands

if TYPE_CHECKING:
    from ..scene import Molvis

logger = logging.getLogger("molvis")

RepresentationStyle = Literal[
    "ball-and-stick",
    "flat",
    "ball-and-tube",
    "tube",
    "metal-tube",
    "wireframe",
    "bubble",
    "spacefill",
    "skeletal",
    "graph",
]

__all__ = ["DrawingCommandsMixin"]


class DrawingCommandsMixin:
    """Mixin class providing drawing commands for Molvis widget."""

    def new_frame(
        self: "Molvis",
        name: str | None = None,
        clear: bool = True,
    ) -> "Molvis":
        """Create a new frame and set it as current."""
        self.send_cmd(
            FrontendCommands.NEW_FRAME.method,
            {"name": name, "clear": clear},
            wait_for_response=True,
        )
        if clear:
            self._clear_mirror()
        self.list_modifiers()
        return self

    def draw_frame(
        self: "Molvis",
        frame: mp.Frame,
        *,
        include_metadata: bool = False,
    ) -> "Molvis":
        """
        Draw a molecular frame on the current canvas.

        Passes molpy Frame data directly to the frontend.  Numeric arrays
        are sent as binary buffers via the transport encoder.

        Args:
            frame: molpy Frame object containing blocks (atoms, bonds, etc.)
            include_metadata: Whether to include frame metadata

        Returns:
            Self for method chaining
        """
        frame_data = frame.to_dict()

        draw_data: dict[str, Any] = {"blocks": frame_data["blocks"]}
        if include_metadata and "metadata" in frame_data:
            draw_data["metadata"] = frame_data["metadata"]

        self.send_cmd(
            FrontendCommands.DRAW_FRAME.method,
            {"frame": draw_data},
            wait_for_response=True,
        )
        self._record_trajectory([frame], None)
        self.list_modifiers()
        return self

    def draw_atomistic(
        self: "Molvis",
        atomistic: Any,
        *,
        include_metadata: bool = False,
        atom_fields: list[str] | None = None,
    ) -> "Molvis":
        """
        Draw an Atomistic object (Molecule, Residue, Crystal, etc.).

        Args:
            atomistic: molpy Atomistic object with a ``to_frame()`` method
            include_metadata: Whether to include frame metadata
            atom_fields: List of atom fields to extract

        Returns:
            Self for method chaining
        """
        frame = (
            atomistic.to_frame(atom_fields=atom_fields)
            if atom_fields is not None
            else atomistic.to_frame()
        )
        return self.draw_frame(
            frame=frame,
            include_metadata=include_metadata,
        )

    def draw_box(
        self: "Molvis",
        box: mp.Box,
        color: str | None = None,
        line_width: float = 1.0,
        visible: bool = True,
    ) -> "Molvis":
        """Draw simulation box on current canvas."""
        self.send_cmd(
            FrontendCommands.DRAW_BOX.method,
            {
                "box": box.to_dict(),
                "options": {
                    "color": color,
                    "lineWidth": line_width,
                    "visible": visible,
                },
            },
        )
        return self

    def draw_atoms(
        self: "Molvis",
        atoms: Any | list[Any],
        *,
        color: str | list[str] | None = None,
    ) -> "Molvis":
        """
        Draw individual atoms or a list of atoms.

        Each atom must be dict-like (molpy Atom, plain dict, etc.) with at
        least ``symbol`` (or ``element``) and ``x``, ``y``, ``z`` coordinates.
        """
        if not isinstance(atoms, list):
            atoms = [atoms]

        symbols: list[str] = []
        x_list: list[float] = []
        y_list: list[float] = []
        z_list: list[float] = []

        for atom in atoms:
            symbols.append(atom.get("symbol", atom.get("element", "C")))
            x_list.append(float(atom.get("x")))
            y_list.append(float(atom.get("y")))
            z_list.append(float(atom.get("z")))

        atoms_block: dict[str, Any] = {
            "symbol": np.array(symbols),
            "x": np.array(x_list, dtype=np.float64),
            "y": np.array(y_list, dtype=np.float64),
            "z": np.array(z_list, dtype=np.float64),
        }

        if color is not None:
            if isinstance(color, str):
                color = [color] * len(atoms)
            atoms_block["color"] = np.array(color)

        frame = mp.Frame(blocks={"atoms": atoms_block})
        return self.draw_frame(frame=frame)

    def clear(self: "Molvis") -> "Molvis":
        """Clear all content from canvas."""
        self.send_cmd(
            FrontendCommands.CLEAR.method, {}, wait_for_response=True
        )
        self._clear_mirror()
        return self

    def set_style(
        self: "Molvis",
        style: RepresentationStyle | None = None,
        atom_radius: float | None = None,
        bond_radius: float | None = None,
        outline: bool | None = None,
    ) -> "Molvis":
        """Set global visualization style parameters."""
        self.send_cmd(
            FrontendCommands.SET_STYLE.method,
            {
                "style": style,
                "outline": outline,
                "atoms": {"radius": atom_radius},
                "bonds": {"radius": bond_radius},
            },
        )
        return self

    def set_theme(self: "Molvis", theme: str) -> "Molvis":
        """Set color theme for molecular visualization."""
        self.send_cmd(FrontendCommands.SET_THEME.method, {"theme": theme})
        return self

    def set_background(self: "Molvis", color: str) -> "Molvis":
        """
        Set background color.

        Args:
            color: ``#RRGGBB`` (opaque) or ``#RRGGBBAA`` (with alpha).
                Examples: ``"#FFFFFF"`` white, ``"#00000000"`` transparent.

        Returns:
            Self for method chaining
        """
        self.send_cmd(FrontendCommands.SET_BACKGROUND.method, {"color": color})
        return self

    def color_by(
        self: "Molvis",
        column: str | None = None,
        colormap: str = "viridis",
        range: tuple[float, float] | None = None,
        clamp: bool = True,
    ) -> "Molvis":
        """
        Color atoms by a frame column.

        Args:
            column: Column name to color by (e.g. ``"type"``, ``"charge"``).
                Use ``"element"`` or ``None`` to reset to default CPK coloring.
            colormap: Backward-compatible numeric ramp hint. Numeric columns
                currently use ``viridis``; categorical columns use the fixed
                ``glasbey-vivid`` palette.
            range: ``(min, max)`` for numeric normalization. Auto-detected
                when ``None``.
            clamp: Clamp out-of-range values (True) or fade to gray (False).

        Returns:
            Self for method chaining
        """
        params: dict[str, Any] = {
            "column": column,
            "colormap": colormap,
            "clamp": clamp,
        }
        if range is not None:
            params["range"] = {"min": range[0], "max": range[1]}
        self.send_cmd(FrontendCommands.COLOR_BY.method, params)
        return self

    def set_view_mode(self: "Molvis", mode: str) -> "Molvis":
        """Set camera view mode."""
        self.send_cmd(FrontendCommands.SET_VIEW_MODE.method, {"mode": mode})
        return self
