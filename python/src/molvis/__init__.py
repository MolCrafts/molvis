"""
MolVis — molecular visualization for Python.

Stage API
---------

Commands are methods on a stage — there is no module-level shortcut::

    import molvis as mv

    stage = mv.Stage()
    stage.draw_frame(frame)
    stage.commit()
    stage.camera.fit()

An earlier version forwarded unknown module attributes to a "current"
stage, pyplot-style (``mv.draw(...)``). That is gone: it made typos
report a missing stage instead of a missing name, hid the API from
editors and type checkers, and collided with the import system —
``from molvis import <submodule>`` probes via ``hasattr``, which only
swallows AttributeError, so the forwarder's RuntimeError aborted the
import outright.

To reach a stage you did not keep a reference to, look it up by name::

    mv.Stage(name="A")          # create / reuse
    mv.Stage.get_scene("A")     # fetch later
    mv.Stage.list_scenes()

``mv.Molvis`` remains an alias of ``mv.Stage`` for older code.

Session management
------------------

    mv.Stage(name="A")                  # cached under "A"
    mv.Stage(name="A")                  # → same instance, becomes current
    mv.Stage(name="A", gui=False)       # → ValueError (cached as gui=True)

    mv.Stage.replace("A", gui=False)    # close existing & recreate
    mv.Stage.list_scenes()              # ["A"]
    mv.Stage.session_summary()          # [{name, gui, connected, port, ...}]
    mv.Stage.close_all()                # tear down every scene

Both hosts drive the same page bundle over a local WebSocket. See
:mod:`molvis.events` for the bidirectional event API and
:mod:`molvis.transport` for configuring the transport explicitly.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _package_version

from .demo import demo_cell_transform, run_demo, strip_demo_magic
from .errors import MolvisRPCError
from .events import EventBus, EventHandle, Selection, ViewerState
from .palettes import (
    PaletteDefinition,
    PaletteEntry,
    PaletteInfo,
    render_palette_preview,
    save_palette_preview_bytes,
)
from .runtime import Appearance, DisplaySurface, RuntimeEnv, detect_runtime, display_surface
from .scene import Molvis
from .stream import FrameStream, StreamError
from .structure import coerce_to_frame, frame_arg, frame_payload, frames_arg
from .transport import InProcessTransport, Transport, WebSocketTransport
from .utils import NumpyEncoder

# Public name: Stage. Molvis kept as a synonym.
Stage = Molvis
# Cell magic / step runner: ``%%mv.demo`` or ``await mv.demo(source, ns)``.
demo = run_demo

__all__ = [
    "Appearance",
    "DisplaySurface",
    "EventBus",
    "EventHandle",
    "FrameStream",
    "InProcessTransport",
    "Molvis",
    "MolvisRPCError",
    "NumpyEncoder",
    "PaletteDefinition",
    "PaletteEntry",
    "PaletteInfo",
    "RuntimeEnv",
    "Selection",
    "Stage",
    "StreamError",
    "Transport",
    "ViewerState",
    "WebSocketTransport",
    "coerce_to_frame",
    "demo",
    "detect_runtime",
    "display_surface",
    "frame_arg",
    "frame_payload",
    "frames_arg",
    "render_palette_preview",
    "run_demo",
    "save_palette_preview_bytes",
    "demo_cell_transform",
    "load_ipython_extension",
    "strip_demo_magic",
]
# Read from installed package metadata; pyproject.toml is synchronized from
# the repository's root package.json before release.
try:
    __version__ = _package_version("molcrafts-molvis")
except PackageNotFoundError:  # pragma: no cover — source tree without install
    __version__ = "0+unknown"


def load_ipython_extension(ipython: object) -> None:
    """Register molvis' IPython input transformers.

    Called by ``%load_ext molvis`` and, for the common case, by molvis
    itself at import time — a notebook that says ``import molvis as mv``
    gets ``%%mv.demo`` without a second incantation.

    Idempotent: re-importing or re-loading does not stack transformers.
    """
    transformers = getattr(ipython, "input_transformers_cleanup", None)
    if transformers is None:
        return
    if demo_cell_transform not in transformers:
        transformers.append(demo_cell_transform)


def _register_with_active_ipython() -> None:
    """Wire into the shell that is already running, if there is one."""
    try:
        from IPython import get_ipython
    except ImportError:
        return
    shell = get_ipython()
    if shell is not None:
        load_ipython_extension(shell)


_register_with_active_ipython()


def __dir__() -> list[str]:
    return sorted({*__all__, "__version__"})
