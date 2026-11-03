"""A 2D formula board with its own name registry.

:class:`Sketch` is not a :class:`~molvis.scene.Molvis`. It does not draw
through the stage pipeline, and it does not detect a notebook display
surface. The same ``name`` may exist on a Stage and on a Sketch at once.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from importlib.resources import files
from pathlib import Path
from typing import Any, ClassVar, Final, NoReturn, Self

logger = logging.getLogger("molvis")

__all__ = ["Sketch", "SketchUnavailable", "resolve_sketch_dist"]


class SketchUnavailable(RuntimeError):
    """The sketch page bundle is missing, or board RPC is not connected."""


class _Unset:
    """Sentinel for parameters the caller did not pass."""

    _singleton: _Unset | None = None

    def __new__(cls) -> Self:
        if cls._singleton is None:
            cls._singleton = super().__new__(cls)
        return cls._singleton

    def __repr__(self) -> str:
        return "<unset>"

    def __bool__(self) -> bool:
        return False


_UNSET: Final[_Unset] = _Unset()


def resolve_sketch_dist() -> Path:
    """Directory of the sketch page bundle.

    ``MOLVIS_SKETCH_DIST`` overrides the packaged ``molvis/sketch_dist``.
    This does not call :func:`molvis.transport.websocket.resolve_dist` and
    does not read ``MOLVIS_DIST``. A missing directory is still returned;
    callers check ``index.html`` themselves.
    """
    override = os.environ.get("MOLVIS_SKETCH_DIST")
    if override:
        return Path(override).expanduser().resolve()
    resource = files("molvis").joinpath("sketch_dist")
    return Path(str(resource)).resolve()


class Sketch:
    """A 2D formula board. Not a Stage, and not on the stage pipeline.

    Parameters
    ----------
    name
        Registry name. A second call with the same name returns this
        object when ``gui``, ``width``, ``height``, and ``transport``
        are omitted or match. An explicit mismatch raises
        ``ValueError``; use :meth:`replace` to close and recreate.
    transport
        Optional transport. Tests pass one. When omitted, the board
        stays registered and does not open a page until
        :attr:`connection_url` or :meth:`wait`.
    width, height
        Session fields. Default 960 and 720. They are not the browser
        tab size.
    gui
        Icon rails when ``True`` (the default). ``False`` selects the
        canvas chrome preset once a page starts.

    Lookup is :meth:`get`, :meth:`list`, and :meth:`has`. There is no
    ``get_scene``. ``draw_frame`` is not a method of this class.
    Document methods raise :class:`SketchUnavailable` until the board
    RPC is connected. They do not call ``send_request``.
    """

    _registry: ClassVar[dict[str, Sketch]] = {}
    _DEFAULT_NAME = "default"

    def __new__(
        cls,
        name: str | None = None,
        *,
        transport: Any | None = None,
        width: int | _Unset = _UNSET,
        height: int | _Unset = _UNSET,
        gui: bool | _Unset = _UNSET,
    ) -> Self:
        board_name = name or cls._DEFAULT_NAME
        existing = cls._registry.get(board_name)
        if existing is None:
            return super().__new__(cls)
        existing._reject_param_conflict(
            transport=transport,
            width=width,
            height=height,
            gui=gui,
        )
        return existing

    def __init__(
        self,
        name: str | None = None,
        *,
        transport: Any | None = None,
        width: int | _Unset = _UNSET,
        height: int | _Unset = _UNSET,
        gui: bool | _Unset = _UNSET,
    ) -> None:
        if getattr(self, "_initialised", False):
            return
        self._initialised = True
        self.name: str = name or self._DEFAULT_NAME
        self.width: int = 960 if isinstance(width, _Unset) else width
        self.height: int = 720 if isinstance(height, _Unset) else height
        self.gui: bool = True if isinstance(gui, _Unset) else gui
        self._created_at: float = time.time()
        # No event bus. A stage notification must not be answered here.
        self._transport: Any | None = transport
        if transport is not None:
            set_session = getattr(transport, "set_session_name", None)
            if callable(set_session):
                set_session(self.name)
        Sketch._registry[self.name] = self
        logger.debug(
            "Sketch '%s' created (gui=%s, %dx%d)",
            self.name,
            self.gui,
            self.width,
            self.height,
        )

    def __repr__(self) -> str:
        status = "connected" if self.connected else "idle"
        return (
            f"Sketch(name={self.name!r}, {self.width}x{self.height}, "
            f"gui={self.gui}, {status})"
        )

    def _reject_param_conflict(
        self,
        *,
        transport: Any | None,
        width: int | _Unset,
        height: int | _Unset,
        gui: bool | _Unset,
    ) -> None:
        if transport is not None and transport is not self._transport:
            raise ValueError(
                f"Sketch(name={self.name!r}) already exists with a different "
                "transport; refusing to attach a new one. "
                f"Use Sketch.replace({self.name!r}, transport=...) to swap, "
                f"or Sketch.get({self.name!r}) to fetch the existing one."
            )
        mismatches: list[str] = []
        if not isinstance(gui, _Unset) and gui != self.gui:
            mismatches.append(f"gui: cached={self.gui!r}, requested={gui!r}")
        if not isinstance(width, _Unset) and width != self.width:
            mismatches.append(f"width: cached={self.width!r}, requested={width!r}")
        if not isinstance(height, _Unset) and height != self.height:
            mismatches.append(f"height: cached={self.height!r}, requested={height!r}")
        if not mismatches:
            return
        details = "\n  ".join(mismatches)
        raise ValueError(
            f"Sketch(name={self.name!r}) already exists with a different "
            f"configuration:\n  {details}\n"
            "Choose one of:\n"
            "  - pass a different name= to open a new board\n"
            f"  - Sketch.replace({self.name!r}, ...) to close and recreate\n"
            f"  - Sketch.get({self.name!r}) to fetch the existing one"
        )

    def _board_rpc(self) -> NoReturn:
        """Board RPC is a later slice. Raise before any ``send_request``."""
        raise SketchUnavailable("sketch board RPC is not connected")

    def _ensure_started(self) -> None:
        """Start the transport, or raise when the sketch bundle is missing.

        Does not call :func:`molvis.transport.websocket.resolve_dist`.
        Does not attach an event bus and does not register a state-sync
        handler.
        """
        if self._transport is None:
            bundle = resolve_sketch_dist()
            index = bundle / "index.html"
            if not index.is_file():
                raise SketchUnavailable(f"sketch page bundle is missing: {index}")
            from .transport.websocket import WebSocketTransport

            self._transport = WebSocketTransport(
                dist=bundle,
                open_browser=False,
                event_bus=None,
                surface="full" if self.gui else "canvas",
                session=self.name,
            )
        start = getattr(self._transport, "start", None)
        if callable(start):
            start()

    @classmethod
    def get(cls, name: str) -> Sketch:
        """Return the board registered under *name*.

        Raises:
            KeyError: No sketch uses *name*. The message lists sketch
                names only.
        """
        try:
            return cls._registry[name]
        except KeyError as exc:
            available = list(cls._registry.keys())
            raise KeyError(
                f"Sketch '{name}' not found. Available sketches: {available}"
            ) from exc

    @classmethod
    def list(cls) -> list[str]:
        """Names of registered boards, in insertion order."""
        return list(cls._registry.keys())

    @classmethod
    def has(cls, name: str) -> bool:
        """Return ``True`` when a board with this *name* is registered."""
        return name in cls._registry

    @classmethod
    def replace(cls, name: str | None = None, **kwargs: Any) -> Sketch:
        """Close any board with this name and create a new one."""
        board_name = name or cls._DEFAULT_NAME
        existing = cls._registry.get(board_name)
        if existing is not None:
            existing.close()
        return cls(name=board_name, **kwargs)

    @classmethod
    def close_all(cls) -> None:
        """Close every registered board and clear the registry."""
        for board in list(cls._registry.values()):
            try:
                board.close()
            except Exception:
                logger.exception("Failed to close sketch '%s'", board.name)
        cls._registry.clear()

    @classmethod
    def session_summary(cls) -> list[dict[str, Any]]:
        """One dict per registered board. Each row includes ``surface``."""
        return [board.session_info for board in cls._registry.values()]

    def close(self) -> Sketch:
        """Stop the transport and drop this board from the registry.

        Does not stop the kernel.
        """
        transport = self._transport
        if transport is not None:
            stop = getattr(transport, "stop", None)
            if callable(stop):
                try:
                    stop()
                except Exception:
                    logger.exception("Transport.stop raised for sketch '%s'", self.name)
        Sketch._registry.pop(self.name, None)
        self._initialised = False
        logger.debug("Sketch '%s' closed", self.name)
        return self

    def wait(self, timeout: float | None = None) -> Sketch:
        """Block until the page disconnects or Ctrl+C, then close.

        Raises:
            SketchUnavailable: The sketch page bundle is missing. Raised
                before the wait, and the board stays registered.
        """
        self._ensure_started()
        wait_for = getattr(self._transport, "wait_for_disconnection", None)
        try:
            if callable(wait_for):
                wait_for(timeout)
            else:
                threading.Event().wait(timeout)
        except KeyboardInterrupt:
            pass
        finally:
            self.close()
        return self

    @property
    def connected(self) -> bool:
        """Whether the transport currently holds a live page session."""
        if self._transport is None:
            return False
        return bool(getattr(self._transport, "connected", False))

    @property
    def session_info(self) -> dict[str, Any]:
        """Identity and connection state. No token, no atom counts."""
        port = 0
        if self._transport is not None:
            port = int(getattr(self._transport, "port", 0) or 0)
        return {
            "surface": "sketch",
            "name": self.name,
            "gui": self.gui,
            "width": self.width,
            "height": self.height,
            "connected": self.connected,
            "port": port,
            "created_at": self._created_at,
        }

    @property
    def connection_url(self) -> str:
        """Pasteable page URL. Starts the transport when a bundle exists.

        Raises:
            SketchUnavailable: ``sketch_dist/index.html`` is missing. The
                message contains that resolved path.
        """
        self._ensure_started()
        fn = getattr(self._transport, "connection_url", None)
        if not callable(fn):
            return ""
        return str(fn(session=self.name))

    def draw_atom(self, element: str, x: float, y: float, *, charge: int = 0) -> int:
        """Draw one atom on the formula. Coordinates are document units, y-up.

        Runs ``AddAtomCommand`` as one undo step. ``element`` is the symbol
        the caller already chose. This method has no element table and no
        ``z``. Returns the new atom index for a later ``draw_bond``.
        """
        del element, x, y, charge
        self._board_rpc()

    def draw_bond(
        self, i: int, j: int, *, order: int = 1, stereo: str = "none"
    ) -> int:
        """Draw one bond between formula atom indices. One undo step.

        ``order`` is 1, 2, or 3. ``stereo`` is ``none``, ``up``, or
        ``down``. Returns the new bond index.
        """
        del i, j, order, stereo
        self._board_rpc()

    def draw_fragment(
        self, template_id: str, x: float, y: float, *, target: int | None = None
    ) -> Sketch:
        """Draw the board's fragment template at (x, y).

        ``template_id`` is an id from ``fragment_templates()``. An unknown
        id raises the board's own error from ``setFragmentTemplate``
        before anything is placed. The call also stores that id as the
        current template, so the next click on the fragment rail uses it.

        When ``target`` is an atom index, the template's ``attachMode``
        decides the landing. ``merge`` puts the root on that atom and
        does not use ``(x, y)``. ``bond`` places the root one bond length
        from the target along +x (``bondDir`` omitted; the command's
        default is ``{x: 1, y: 0}``). This method does not name or expand
        fragments and does not take a direction argument.
        """
        del template_id, x, y, target
        self._board_rpc()

    def draw_ring(
        self, x: float, y: float, *, size: int = 6, kind: str = "benzene"
    ) -> Sketch:
        """Draw the board's ring template, centered at (x, y).

        ``size`` is 3..8. ``kind`` is ``aliphatic`` or ``benzene``.
        The wire always sends ``kind``. The board method
        ``setRingTemplate(size)`` defaults kind to ``aliphatic``, while
        a fresh board's ``ringKind`` is ``benzene``. Omitting ``kind``
        would change that. This call also stores size and kind for the
        next click on the ring rail. Edge length is the board default,
        not a free radius. One undo step.
        """
        del x, y, size, kind
        self._board_rpc()

    def draw_chain(
        self,
        x0: float,
        y0: float,
        x1: float,
        y1: float,
        *,
        start: int | None = None,
    ) -> Sketch:
        """Draw the board's carbon chain from (x0, y0) toward (x1, y1).

        One undo step. ``start is None`` uses ``PlaceChainFromPointCommand``
        and creates the first atom on empty paper. An integer ``start``
        uses ``PlaceChainCommand`` from that atom toward ``(x1, y1)``;
        ``x0`` and ``y0`` are then ignored. Every new atom is element
        ``C``. Step is the board's ``bondChainStep`` (default
        ``DEFAULT_BOND_LENGTH``, 1.0). Bond order is 1. Color is not
        set. This does not read ``getElement``, ``getBondOrder``, or the
        toolbar color, and it does not switch the tool to ``chain``.
        ``validateChainPlacement`` rejects any order other than 1.
        This is not a SMILES or formula builder.
        """
        del x0, y0, x1, y1, start
        self._board_rpc()

    def clear(self) -> Sketch:
        """Clear the formula as one undo step. No-op when already empty."""
        self._board_rpc()

    def undo(self) -> Sketch:
        """Reverse the last board command. No-op when the board cannot undo."""
        self._board_rpc()

    def redo(self) -> Sketch:
        """Re-apply the last undone board command."""
        self._board_rpc()

    def select_atom_by_id(self, atom_ids: int | list[int]) -> Sketch:
        """Replace the formula's atom selection by document index.

        One index or a list, same argument shape as
        ``Stage.select_atom_by_id``. Out-of-range indices are ignored.
        Also clears the bond selection, because ``replaceSelectedAtoms``
        calls ``clearSelection()`` first. Does not emit
        ``event.selection_changed`` and does not fill a ``Selection``.
        Read the indices back with ``selected_atoms``.
        """
        del atom_ids
        self._board_rpc()

    def selected_atoms(self) -> list[int]:
        """Sorted atom indices in the current formula selection."""
        self._board_rpc()

    def delete_selection(self) -> Sketch:
        """Delete the current atom and bond selection as one undo step."""
        self._board_rpc()

    def molecule(self) -> dict[str, Any]:
        """Deep copy of the document as MoleculeData. Mutating it does not change the board."""
        self._board_rpc()

    def load(self, data: dict[str, Any]) -> Sketch:
        """Replace the 2D document with MoleculeData.

        Clears board history, as ``loadMoleculeData`` does. This is not
        ``draw_frame``.
        """
        del data
        self._board_rpc()

    def fragment_templates(self) -> list[dict[str, Any]]:
        """Ids and category ids from the board's template table.

        Each item is ``{"id": str, "category": str}``. Category ids are the
        board's own (``groups``, ``rings``, ``fused``). What an id draws is
        that table, not this docstring. Pass the id to ``draw_fragment``.
        """
        self._board_rpc()

    def export_svg(self, path: str | None = None) -> str:
        """Fitted, selection-free SVG of the formula. Written to ``path`` when given."""
        del path
        self._board_rpc()

    def export_png(self, path: str | None = None) -> bytes:
        """Fitted, selection-free PNG of the formula. Written to ``path`` when given."""
        del path
        self._board_rpc()

    def fit(self) -> Sketch:
        """Fit the 2D viewport to the atoms. Not a camera, and not an undo step."""
        self._board_rpc()

    def to_frame(self) -> dict[str, Any]:
        """JSON topology snapshot. Not a molrs ``Frame``, and not stored here.

        The board's ``MoleculeGraph`` is unchanged. The returned dict is
        not kept on this object. Shape, no ``x`` and no ``y``:

        ``{"blocks": {"atoms": {"element": [str, ...]},
        "bonds": {"atomi": [int, ...], "atomj": [...],
        "bond_type": [...], "bond_number": [...]}}}``

        When there are no bonds, ``bonds`` is omitted, matching
        ``MoleculeGraph.toFrame``. Bond columns are the Kekulé order
        1–3 that ``toFrame`` writes as u32. The sketch page builds this
        from ``getMoleculeData()``. It does not ``JSON.stringify`` the
        molrs ``Frame`` and it does not use ``BUFFER_REF_MARKER``.

        A caller may pass the dict to ``Stage.draw_frame``.
        ``coerce_to_frame`` accepts a mapping with ``blocks``
        (``python/src/molvis/structure.py``). This method does not call
        ``draw_frame``. The picture's 2D coordinates are not in the dict.
        """
        self._board_rpc()

    def state(self) -> dict[str, Any]:
        """The board's ``SketchBoardState``, whole.

        Fields: ``tool``, ``element``, ``bondOrder``, ``ringSize``,
        ``ringKind``, ``fragmentId``, ``stereoMode``, ``chargeDelta``,
        ``customColor``, ``colorOverrideEnabled``, ``disabled``,
        ``canUndo``, ``canRedo``, ``atomCount``, ``bondCount``,
        ``selectedAtomCount``, ``selectedBondCount``. Not a subset.
        """
        self._board_rpc()
