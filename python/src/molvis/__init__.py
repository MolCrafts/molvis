"""
MolVis — molecular visualization for Python.

Single entry point
------------------

    import molvis as mv

    viewer = mv.Molvis()                  # plain script: opens a browser tab
    viewer.draw_frame(frame)
    viewer.snapshot()

    scene = mv.Molvis(name="protein")     # Jupyter cell: displays as iframe
    scene

Session management
------------------

    mv.Molvis(name="A")                  # cached under "A"
    mv.Molvis(name="A")                  # → same instance
    mv.Molvis(name="A", gui=False)       # → ValueError (cached as gui=True)

    mv.Molvis.replace("A", gui=False)    # close existing & recreate
    mv.Molvis.list_scenes()              # ["A"]
    mv.Molvis.session_summary()          # [{name, gui, connected, port, ...}]
    mv.Molvis.close_all()                # tear down every scene

Both hosts drive the same page bundle over a local WebSocket. See
:mod:`molvis.events` for the bidirectional event API
(:meth:`Molvis.on`, :meth:`Molvis.wait_for`, :attr:`Molvis.selection`,
:attr:`Molvis.current_mode`, …) and :mod:`molvis.transport` for
configuring the transport explicitly (CDN-hosted page, custom port, …).
"""

from .errors import MolvisRPCError
from .events import EventBus, EventHandle, Selection, ViewerState
from .palettes import (
    PaletteDefinition,
    PaletteEntry,
    PaletteInfo,
    render_palette_preview,
    save_palette_preview_bytes,
)
from .runtime import DisplaySurface, RuntimeEnv, detect_runtime, display_surface
from .scene import Molvis
from .transport import Transport, WebSocketTransport
from .utils import NumpyEncoder

__all__ = [
    "DisplaySurface",
    "EventBus",
    "EventHandle",
    "Molvis",
    "MolvisRPCError",
    "NumpyEncoder",
    "PaletteDefinition",
    "PaletteEntry",
    "PaletteInfo",
    "RuntimeEnv",
    "Selection",
    "Transport",
    "ViewerState",
    "WebSocketTransport",
    "detect_runtime",
    "display_surface",
    "render_palette_preview",
    "save_palette_preview_bytes",
]
__version__ = "0.0.9"
