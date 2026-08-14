"""Drawing and visualization commands for MolVis."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Literal

import molpy as mp
from molrs import keys

from ..structure import frame_arg, frame_payload
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

ColorTheme = Literal["tab10", "ovito"]

#: Catalog of representation ids (same order as stage ``REPRESENTATION_IDS``).
STYLE: tuple[str, ...] = (
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
)

#: Catalog of **color-palette** theme ids accepted by ``view.set_theme``
#: (atom/bond colours only — not viewport background).
THEME: tuple[str, ...] = ("tab10", "ovito")

__all__ = ["ColorTheme", "DrawingCommandsMixin", "RepresentationStyle", "STYLE", "THEME"]


class DrawingCommandsMixin:
    """Drawing commands for :class:`~molvis.scene.Molvis`.

    **Edit working tree.** ``draw_atom`` / ``draw_bond`` / ``draw_frame`` go
    through the same command path as Edit mode (``DrawAtomCommand`` /
    ``DrawBondCommand`` / ``PlaceMoleculeCommand``). They mutate the live
    scene mesh pool only — **molrs HEAD is unchanged until**
    :meth:`commit` (Ctrl+S in the UI).

    Only :meth:`clear` (or ``new_frame(clear=True)``) wipes the canvas.
    Multi-frame trajectories: seek the frame you want first; draws never
    switch frames for you.

    Structure-bearing methods take the Frame / Atomistic / molgraph as the
    **first** argument after ``self``. :func:`~molvis.structure.frame_arg`
    coerces it; :func:`~molvis.structure.frame_payload` serializes it through
    :mod:`molvis.wire`, which states every column's dtype explicitly.

    Column names are molrs's (:mod:`molrs.keys`) — this layer never invents or
    renames one.

    Class attributes :attr:`STYLE` and :attr:`THEME` list every supported
    representation / color theme so callers can iterate::

        for style in stage.STYLE:
            for theme in stage.THEME:
                stage.set_style(style)
                stage.set_theme(theme)
    """

    #: Iterable of representation style ids (see :data:`STYLE`).
    STYLE: tuple[str, ...] = STYLE
    #: Iterable of color theme ids (see :data:`THEME`).
    THEME: tuple[str, ...] = THEME

    def new_frame(
        self: "Molvis",
        name: str | None = None,
        clear: bool = True,
    ) -> "Molvis":
        """Create a new frame and set it as current.

        When ``clear=True`` (default) this is an explicit wipe of scene
        content (same family as :meth:`clear`).
        """
        self.send_cmd(
            FrontendCommands.NEW_FRAME.method,
            {"name": name, "clear": clear},
            wait_for_response=True,
        )
        if clear:
            self._clear_mirror()
            self._atom_ids = []
        self.list_modifiers()
        return self

    @frame_arg
    def draw_frame(self: "Molvis", frame: Any) -> "Molvis":
        """Place a molecular frame into the edit working tree.

        Same path as Edit-mode molecule stamp (``PlaceMoleculeCommand``).
        Does **not** write molrs HEAD — call :meth:`commit` to save.

        Parameters
        ----------
        frame
            First argument: ``Frame``, Atomistic/molgraph (``to_frame``), or a
            frame mapping with ``blocks``. Its box, when it has one, travels
            with it — there is no separate box argument.
        """
        payload, buffers = frame_payload(frame)
        result = self.send_cmd(
            FrontendCommands.DRAW_FRAME.method,
            {"frame": payload},
            buffers=buffers,
            wait_for_response=True,
        )
        atom_ids = _as_int_list((result or {}).get("atomIds"))
        if atom_ids:
            self._atom_ids.extend(atom_ids)
        self.list_modifiers()
        return self

    @frame_arg
    def draw_atomistic(
        self: "Molvis",
        atomistic: Any,
        *,
        atom_fields: list[str] | None = None,
    ) -> "Molvis":
        """Place an Atomistic / molgraph via :meth:`draw_frame`.

        Prefer the explicit :meth:`draw_frame` + :meth:`commit` pair for
        structures that should become pipeline HEAD.
        """
        return self.draw_frame(atomistic)

    def draw_box(self: "Molvis", box: mp.Box) -> "Molvis":
        """Draw a simulation box on its own.

        Prefer setting ``frame.box`` and calling :meth:`draw_frame`; a box
        attached to the frame stays in step with the coordinates it belongs to.
        """
        from ..wire import encode_box

        self.send_cmd(
            FrontendCommands.DRAW_BOX.method,
            {"box": encode_box(box)},
            wait_for_response=True,
        )
        return self

    def draw_atoms(self: "Molvis", atoms: mp.Frame | Any) -> "Molvis":
        """Place *atoms* into the edit working tree (same as :meth:`draw_frame`).

        Takes a Frame (or anything :func:`coerce_to_frame` accepts). Does not
        clear prior content — use :meth:`clear` first when you want a wipe.
        Call :meth:`commit` to write HEAD.
        """
        return self.draw_frame(atoms)

    def draw_atom(
        self: "Molvis",
        atom: Any | None = None,
        /,
        **fields: Any,
    ) -> "Molvis":
        """Place one atom in the edit working tree (``DrawAtomCommand``).

        Accepts either keyword fields or a single mapping (e.g. a molrs
        Block row ``atoms[i]``)::

            stage.draw_atom(x=0, y=0, z=0, element="C")
            stage.draw_atom(atoms[i])           # mapping row
            stage.draw_atom(**atoms[i])         # same, unpacked

        Fields must include molrs coordinates ``x``, ``y``, ``z`` and
        ``element`` (or ``symbol``). Indices for a later :meth:`draw_bond`
        follow the order of :meth:`draw_atom` / :meth:`draw_frame` calls
        in this session (0-based progressive indices).

        Does **not** write molrs HEAD — call :meth:`commit` (Ctrl+S).
        """
        if atom is not None:
            if fields:
                raise TypeError(
                    "draw_atom accepts either a row mapping or keyword fields, not both"
                )
            if not isinstance(atom, dict):
                # Mapping-like (e.g. UserDict) without being a dict
                try:
                    fields = dict(atom)
                except (TypeError, ValueError) as exc:
                    raise TypeError(
                        "draw_atom positional arg must be a mapping of "
                        f"field → value; got {type(atom)!r}"
                    ) from exc
            else:
                fields = atom

        missing = [axis for axis in keys.COORDS if axis not in fields]
        if missing:
            raise TypeError(
                f"draw_atom needs coordinates {keys.COORDS}; missing {missing}"
            )
        element = fields.get("element", fields.get("symbol"))
        if element is None or element == "":
            raise TypeError("draw_atom needs 'element' (or 'symbol')")
        params: dict[str, Any] = {
            "x": float(fields["x"]),
            "y": float(fields["y"]),
            "z": float(fields["z"]),
            "element": str(element),
        }
        result = self.send_cmd(
            FrontendCommands.DRAW_ATOM.method,
            params,
            wait_for_response=True,
        )
        atom_id = (result or {}).get("atomId")
        if isinstance(atom_id, int):
            self._atom_ids.append(atom_id)
        return self

    def draw_bond(self: "Molvis", atomi: int, atomj: int, /, **fields: Any) -> "Molvis":
        """Place one bond in the edit working tree (``DrawBondCommand``).

        Indices refer to the order of prior :meth:`draw_atom` /
        :meth:`draw_frame` placements in this session (0-based). Both
        endpoints must already exist. Does **not** write HEAD — call
        :meth:`commit`.
        """
        i, j = int(atomi), int(atomj)
        n = len(self._atom_ids)
        if not (0 <= i < n and 0 <= j < n):
            raise IndexError(
                f"draw_bond({i}, {j}): need both atoms drawn first "
                f"(have {n} session atom(s))"
            )
        params: dict[str, Any] = {
            "atomi": self._atom_ids[i],
            "atomj": self._atom_ids[j],
        }
        if "order" in fields:
            params["order"] = fields["order"]
        self.send_cmd(
            FrontendCommands.DRAW_BOND.method,
            params,
            wait_for_response=True,
        )
        return self

    def commit(self: "Molvis") -> "Molvis":
        """Commit the edit working tree into molrs HEAD (same as Ctrl+S)."""
        self.send_cmd(
            FrontendCommands.COMMIT.method,
            {},
            wait_for_response=True,
        )
        self.list_modifiers()
        return self

    def clear(self: "Molvis") -> "Molvis":
        """Clear all content from the canvas (the only full wipe)."""
        self._atom_ids = []
        self.send_cmd(FrontendCommands.CLEAR.method, {}, wait_for_response=True)
        self._clear_mirror()
        return self

    def set_style(
        self: "Molvis",
        style: RepresentationStyle | None = None,
        *,
        atom_radius: float | None = None,
        bond_radius: float | None = None,
        outline: bool | None = None,
    ) -> "Molvis":
        """Set the global **representation** (geometry), not color theme.

        Color themes are :meth:`set_theme` — keep the two concerns separate.

        Parameters
        ----------
        style
            Representation id from :attr:`STYLE` (e.g. ``"spacefill"``).
            Optional when only radii / outline are changing.
        atom_radius, bond_radius, outline
            Optional representation tweaks.

        Examples
        --------
        ::

            stage.set_style("spacefill")
            stage.set_style("graph", outline=False)
            for style in stage.STYLE:
                stage.set_style(style)
        """
        if (
            style is None
            and atom_radius is None
            and bond_radius is None
            and outline is None
        ):
            raise TypeError(
                "set_style needs style and/or atom_radius/bond_radius/outline"
            )
        if style is not None and style not in STYLE:
            raise ValueError(
                f"unknown style {style!r}; expected one of {list(STYLE)}"
            )
        self.send_cmd(
            FrontendCommands.SET_STYLE.method,
            {
                "style": style,
                "outline": outline,
                "atoms": {"radius": atom_radius},
                "bonds": {"radius": bond_radius},
            },
            wait_for_response=True,
        )
        return self

    def set_theme(self: "Molvis", theme: ColorTheme | str) -> "Molvis":
        """Set the global **color palette** (atom/bond colours only).

        Accepted values are listed on :attr:`THEME`
        (``tab10`` / ``ovito``). This does **not** change the
        viewport background, selection chrome, or representation geometry —
        use the host/UI for background and :meth:`set_style` for geometry.

        Examples
        --------
        ::

            stage.set_theme("tab10")
            for theme in stage.THEME:
                stage.set_theme(theme)
        """
        name = str(theme).strip().lower()
        if name not in THEME:
            raise ValueError(
                f"unknown theme {theme!r}; expected one of {list(THEME)}"
            )
        self.send_cmd(
            FrontendCommands.SET_THEME.method,
            {"theme": name},
            wait_for_response=True,
        )
        return self

    def set_view_mode(self: "Molvis", mode: str) -> "Molvis":
        """Set camera view mode."""
        self.send_cmd(FrontendCommands.SET_VIEW_MODE.method, {"mode": mode})
        return self


def _as_int_list(value: Any) -> list[int]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [int(v) for v in value]
    return []
