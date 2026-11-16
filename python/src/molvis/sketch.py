"""A 2D formula board with its own name registry.

:class:`Sketch` is not a :class:`~molvis.scene.Molvis`. It does not draw
through the stage pipeline, and it does not detect a notebook display
surface. The same ``name`` may exist on a Stage and on a Sketch at once.
"""

from __future__ import annotations

import base64
import logging
import os
import threading
import time
from importlib.resources import files
from pathlib import Path
from typing import Any, ClassVar, Final, Self

from .errors import MolvisRPCError

logger = logging.getLogger("molvis")

__all__ = ["Sketch", "SketchUnavailable", "resolve_sketch_dist"]


class SketchUnavailable(RuntimeError):
    """The sketch page bundle is missing, or the page answered nonsense."""


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
    headless
        ``True`` loads the board page in headless Chromium that molvis
        starts itself, so document methods and exports work with no
        display (the ``molcrafts-molvis[headless]`` extra). ``None`` waits
        for a page connected by hand via :attr:`connection_url` and falls
        back to headless Chromium when none attaches in time. ``False``
        never starts a browser. Omitted, it is ``True`` on a headless
        surface (``MOLVIS_HEADLESS=1``, Linux with no display) and ``None``
        otherwise.

    Lookup is :meth:`get`, :meth:`list`, and :meth:`has`. There is no
    ``get_scene``. ``draw_frame`` is not a method of this class.
    Document methods are ``sketch.*`` JSON-RPC requests to the board page
    (``molvis/sketch_dist``); the first one starts the transport.

    Example
    -------
        >>> board = mv.Sketch(name="pbix", headless=True)
        >>> board.load_smiles("c1ccc(CCC[N+](C)(C)C)cc1")
        >>> board.export_svg("pbix.svg")
    """

    #: Seconds a document request may take; a PNG export of a large
    #: formula is the slowest.
    RPC_TIMEOUT_S: ClassVar[float] = 30.0

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
        headless: bool | None | _Unset = _UNSET,
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
            headless=headless,
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
        headless: bool | None | _Unset = _UNSET,
    ) -> None:
        if getattr(self, "_initialised", False):
            return
        self._initialised = True
        self.name: str = name or self._DEFAULT_NAME
        self.width: int = 960 if isinstance(width, _Unset) else width
        self.height: int = 720 if isinstance(height, _Unset) else height
        self.gui: bool = True if isinstance(gui, _Unset) else gui
        if headless is True and transport is not None:
            raise ValueError(
                "headless=True applies to the default transport; pass "
                "WebSocketTransport(headless=True) to a custom one"
            )
        # Resolved lazily in _ensure_started: constructing a board never
        # probes the runtime.
        self._headless: bool | None | _Unset = headless
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
        headless: bool | None | _Unset = _UNSET,
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
        if not isinstance(headless, _Unset) and headless != self._headless:
            mismatches.append(
                f"headless: cached={self._headless!r}, requested={headless!r}"
            )
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

    def _call(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """One ``sketch.*`` request to the page; returns its result.

        Raises:
            SketchUnavailable: The sketch page bundle is missing.
            MolvisRPCError: The page rejected the request (bad params, or
                the board refused it).
            TimeoutError: No page attached, or no answer within
                :attr:`RPC_TIMEOUT_S`.
        """
        self._ensure_started()
        assert self._transport is not None
        response = self._transport.send_request(
            method,
            params or {},
            wait_for_response=True,
            timeout=self.RPC_TIMEOUT_S,
        )
        if isinstance(response, dict) and "error" in response:
            error = response["error"] or {}
            raise MolvisRPCError(
                method=method,
                code=int(error.get("code", -32603)),
                message=str(error.get("message", "Unknown sketch page error")),
                data=error.get("data"),
                request_id=response.get("id"),
            )
        if isinstance(response, dict) and "result" in response:
            return response["result"]
        raise SketchUnavailable(f"sketch page sent no result for {method}: {response!r}")

    def _resolve_headless(self) -> bool | None:
        """Headless policy for the default transport (see ``headless``)."""
        if not isinstance(self._headless, _Unset):
            return self._headless
        from .runtime import DisplaySurface, display_surface

        return True if display_surface() is DisplaySurface.HEADLESS else None

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
                raise SketchUnavailable(
                    f"sketch page bundle is missing: {index}. A source checkout "
                    "builds it with `npm run build:sketch-page`."
                )
            from .transport.websocket import WebSocketTransport

            self._transport = WebSocketTransport(
                dist=bundle,
                open_browser=False,
                event_bus=None,
                surface="full" if self.gui else "canvas",
                session=self.name,
                headless=self._resolve_headless(),
                viewport=(self.width, self.height),
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

    def wait_for_page(self, timeout: float | None = None) -> Sketch:
        """Block until a browser page attaches to this board.

        ``None`` (the default) waits without a deadline — a person may open
        :attr:`connection_url` at any time. Document methods sent before a
        page attaches give up after a few seconds, so a live board waits
        here first.

        Raises:
            SketchUnavailable: The sketch page bundle is missing.
            TimeoutError: *timeout* passed with no page attached.
        """
        self._ensure_started()
        wait = getattr(self._transport, "wait_for_connection", None)
        if callable(wait):
            wait(timeout)
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
    def page_url(self) -> str:
        """The ``http://`` page a person opens to see this board.

        Not :attr:`connection_url`, which is the page's WebSocket and does
        not load in a browser. Starts the transport when needed; an empty
        string when the transport composes no page (a test fake).
        """
        self._ensure_started()
        endpoints = getattr(self._transport, "page_endpoints", None)
        if not callable(endpoints):
            return ""
        return str(endpoints(session=self.name).standalone_url)

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
        params: dict[str, Any] = {"element": element, "x": float(x), "y": float(y)}
        if charge:
            params["charge"] = int(charge)
        return int(self._call("sketch.draw_atom", params))

    def draw_bond(
        self, i: int, j: int, *, order: int = 1, stereo: str = "none"
    ) -> int:
        """Draw one bond between formula atom indices. One undo step.

        ``order`` is 1, 2, or 3. ``stereo`` is ``none``, ``up``, or
        ``down``. Returns the new bond index.
        """
        return int(
            self._call(
                "sketch.draw_bond",
                {"i": int(i), "j": int(j), "order": int(order), "stereo": stereo},
            )
        )

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
        params: dict[str, Any] = {"template_id": template_id, "x": float(x), "y": float(y)}
        if target is not None:
            params["target"] = int(target)
        self._call("sketch.draw_fragment", params)
        return self

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
        self._call(
            "sketch.draw_ring",
            {"x": float(x), "y": float(y), "size": int(size), "kind": kind},
        )
        return self

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
        For a whole molecule use :meth:`load_smiles` or :meth:`load_molecule`.
        """
        params: dict[str, Any] = {
            "x0": float(x0),
            "y0": float(y0),
            "x1": float(x1),
            "y1": float(y1),
        }
        if start is not None:
            params["start"] = int(start)
        self._call("sketch.draw_chain", params)
        return self

    def clear(self) -> Sketch:
        """Clear the formula as one undo step. No-op when already empty."""
        self._call("sketch.clear")
        return self

    def undo(self) -> Sketch:
        """Reverse the last board command. No-op when the board cannot undo."""
        self._call("sketch.undo")
        return self

    def redo(self) -> Sketch:
        """Re-apply the last undone board command."""
        self._call("sketch.redo")
        return self

    def select_atom_by_id(self, atom_ids: int | list[int]) -> Sketch:
        """Replace the formula's atom selection by document index.

        One index or a list, same argument shape as
        ``Stage.select_atom_by_id``. Out-of-range indices are ignored.
        Also clears the bond selection, because ``replaceSelectedAtoms``
        calls ``clearSelection()`` first. Does not emit
        ``event.selection_changed`` and does not fill a ``Selection``.
        Read the indices back with ``selected_atoms``.
        """
        ids = [atom_ids] if isinstance(atom_ids, int) else list(atom_ids)
        self._call("sketch.select_atoms", {"atom_ids": [int(i) for i in ids]})
        return self

    def selected_atoms(self) -> list[int]:
        """Sorted atom indices in the current formula selection."""
        return [int(i) for i in self._call("sketch.selected_atoms")]

    def delete_selection(self) -> Sketch:
        """Delete the current atom and bond selection as one undo step."""
        self._call("sketch.delete_selection")
        return self

    def molecule(self) -> dict[str, Any]:
        """Deep copy of the document as MoleculeData. Mutating it does not change the board."""
        return dict(self._call("sketch.molecule"))

    def load(self, data: dict[str, Any]) -> Sketch:
        """Replace the 2D document with MoleculeData.

        Clears board history, as ``loadMoleculeData`` does, and fits the
        view. Atoms may omit ``x``/``y``: when any atom has none, the page
        lays the whole molecule out (rings, zig-zag chains, branches). Atoms
        may carry ``charge``, ``hydrogens`` (drawn into the label) and
        ``port`` (drawn as an attachment marker). This is not ``draw_frame``.
        """
        if not isinstance(data, dict) or not {"atoms", "bonds"} <= data.keys():
            raise TypeError("load expects {'atoms': [...], 'bonds': [...]}")
        self._call("sketch.load", {"data": data})
        return self

    def load_molecule(self, molecule: Any) -> Sketch:
        """Replace the document with a molpy structure, drawn as a formula.

        ``molecule`` is an :class:`molpy.Atomistic`, a :class:`molpy.Frame`
        or a ``{"blocks": …}`` mapping. Kekulé orders and hydrogens are
        perceived, charges are shown, ports (a frame ``ports`` block) are
        marked, and the molecule is laid out unless it already carries a
        flat 2D picture (see :class:`~molvis.sketch_topology.SketchTopology`).
        """
        from molpy.core import Atomistic

        from .sketch_topology import SketchTopology

        if isinstance(molecule, Atomistic):
            topology = SketchTopology.from_atomistic(molecule)
        elif callable(getattr(molecule, "to_frame", None)):
            topology = SketchTopology.from_frame(molecule.to_frame())
        else:
            topology = SketchTopology.from_frame(molecule)
        return self.load(topology.to_payload())

    def load_smiles(self, smiles: str) -> Sketch:
        """Replace the document with a SMILES string, parsed by molpy.

        Bonding descriptors (``[<]CCO[>]``, ``[$]…``) make a ported
        fragment: the anchor atoms get port markers.
        """
        from .sketch_topology import SketchTopology

        return self.load(SketchTopology.from_smiles(smiles).to_payload())

    def fragment_templates(self) -> list[dict[str, Any]]:
        """Ids and category ids from the board's template table.

        Each item is ``{"id": str, "category": str}``. Category ids are the
        board's own (``groups``, ``rings``, ``fused``). What an id draws is
        that table, not this docstring. Pass the id to ``draw_fragment``.
        """
        return [dict(item) for item in self._call("sketch.fragment_templates")]

    def export_svg(
        self,
        path: str | os.PathLike[str] | None = None,
        *,
        width: int | None = None,
        height: int | None = None,
        padding: float | None = None,
        background: str | None = None,
    ) -> str:
        """Fitted, selection-free SVG of the formula. Written to ``path`` when given.

        ``width``/``height`` are the image size in pixels (default
        1200x800), ``padding`` the margin, ``background`` the paper color.
        """
        svg = str(
            self._call(
                "sketch.export_svg",
                _export_params(width, height, padding, background, None),
            )
        )
        if path is not None:
            Path(path).expanduser().write_text(svg, encoding="utf-8")
        return svg

    def export_png(
        self,
        path: str | os.PathLike[str] | None = None,
        *,
        width: int | None = None,
        height: int | None = None,
        padding: float | None = None,
        background: str | None = None,
        pixel_ratio: float | None = None,
    ) -> bytes:
        """Fitted, selection-free PNG of the formula. Written to ``path`` when given.

        Same sizing as :meth:`export_svg`; ``pixel_ratio`` (default 2)
        multiplies the pixel size for a sharper raster.
        """
        result = self._call(
            "sketch.export_png",
            _export_params(width, height, padding, background, pixel_ratio),
        )
        if not isinstance(result, dict) or not isinstance(result.get("data"), str):
            raise SketchUnavailable(f"sketch page sent no PNG: {result!r}")
        encoded = result["data"].split(",", 1)[-1]
        png = base64.b64decode(encoded)
        if path is not None:
            Path(path).expanduser().write_bytes(png)
        return png

    def fit(self) -> Sketch:
        """Fit the 2D viewport to the atoms. Not a camera, and not an undo step."""
        self._call("sketch.fit")
        return self

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
        return dict(self._call("sketch.to_frame"))

    def state(self) -> dict[str, Any]:
        """The board's ``SketchBoardState``, whole.

        Fields: ``tool``, ``element``, ``bondOrder``, ``ringSize``,
        ``ringKind``, ``fragmentId``, ``stereoMode``, ``chargeDelta``,
        ``customColor``, ``colorOverrideEnabled``, ``disabled``,
        ``canUndo``, ``canRedo``, ``atomCount``, ``bondCount``,
        ``selectedAtomCount``, ``selectedBondCount``. Not a subset.
        """
        return dict(self._call("sketch.state"))


def _export_params(
    width: int | None,
    height: int | None,
    padding: float | None,
    background: str | None,
    pixel_ratio: float | None,
) -> dict[str, Any]:
    """Only the export options the caller set; the page owns the defaults."""
    params: dict[str, Any] = {}
    if width is not None:
        params["width"] = int(width)
    if height is not None:
        params["height"] = int(height)
    if padding is not None:
        params["padding"] = float(padding)
    if background is not None:
        params["background"] = background
    if pixel_ratio is not None:
        params["pixel_ratio"] = float(pixel_ratio)
    return params
