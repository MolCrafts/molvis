"""Detect the Python runtime context and pick a display surface for a scene.

Why this exists
---------------

:class:`Molvis` is used from four distinct host contexts that each
expect different behaviour:

``SCRIPT``
    A plain ``python foo.py`` invocation. No rich-display protocol is
    available. The viewer must open in a separate browser tab.

``PYTHON_REPL``
    Plain interactive Python (``python`` or ``python -i``) with
    ``sys.ps1`` but *no* IPython. Same surface as ``SCRIPT``.

``IPYKERNEL``
    An IPython terminal shell (``ipython``). IPython is loaded but the
    shell is :class:`IPython.terminal.interactiveshell.TerminalInteractiveShell`,
    which does not render ``text/html`` mimebundles. The viewer still
    opens in a browser tab, but command chains feel nicer because the
    REPL echoes the returned ``Molvis`` ``__repr__``.

``JUPYTER`` / ``COLAB`` / ``VSCODE_NOTEBOOK``
    A ZMQ kernel attached to a web-based notebook host. The host
    *does* render ``_repr_mimebundle_`` output, so the viewer mounts
    inline in the cell output and the separate browser tab must not
    be opened.

The scene's ``__init__`` and ``_repr_mimebundle_`` consult this module
to keep behaviour consistent across all four hosts *without* the caller
having to pass ``open_browser=`` by hand.

Single-process assumption
-------------------------

Runtime kind cannot change inside a running Python process, so both
:func:`detect_runtime` and :func:`display_surface` are cached with
:func:`functools.cache`. Tests that monkeypatch env-detection helpers
must call ``detect_runtime.cache_clear()`` in a fixture to see the
override take effect.
"""

from __future__ import annotations

import enum
import functools
import os
import sys

__all__ = [
    "DisplaySurface",
    "RuntimeEnv",
    "detect_runtime",
    "display_surface",
    "is_notebook_host",
    "supports_browser",
]


class RuntimeEnv(str, enum.Enum):
    """The kind of Python process hosting this scene."""

    SCRIPT = "script"
    """Non-interactive ``python foo.py`` run."""

    PYTHON_REPL = "python_repl"
    """Plain interactive Python (``sys.ps1`` set, no IPython)."""

    IPYKERNEL = "ipykernel"
    """IPython terminal shell — ``TerminalInteractiveShell``."""

    JUPYTER = "jupyter"
    """Browser-hosted Jupyter notebook or JupyterLab (ZMQ kernel)."""

    COLAB = "colab"
    """Google Colab (ZMQ kernel, ``google.colab`` importable)."""

    VSCODE_NOTEBOOK = "vscode_notebook"
    """VSCode's Jupyter extension (ZMQ kernel, ``VSCODE_PID`` set)."""


class Appearance(str, enum.Enum):
    """Light or dark chrome for the viewer.

    Orthogonal to the molecule palette chosen by ``set_theme``
    (``tab10`` / ``ovito``): this one is the UI's
    light/dark mode, the same axis as ``prefers-color-scheme``.
    """

    LIGHT = "light"
    DARK = "dark"


class DisplaySurface(str, enum.Enum):
    """Where the rendered viewer appears for the current runtime."""

    INLINE = "inline"
    """Rich ``text/html`` mimebundle rendered in a notebook cell."""

    BROWSER = "browser"
    """Separate browser tab driven over a WebSocket."""

    HEADLESS = "headless"
    """No display surface — command results must be read via APIs."""


# ---------------------------------------------------------------------------
# Detection helpers
# ---------------------------------------------------------------------------


def _get_ipython_shell() -> object | None:
    """Return the active IPython shell instance, or ``None``.

    Wrapped for test-monkeypatchability; also silences ``ImportError``
    when IPython is not installed.
    """
    try:
        from IPython import get_ipython
    except ImportError:
        return None
    try:
        return get_ipython()
    except Exception:
        return None


def _has_google_colab() -> bool:
    try:
        import google.colab  # type: ignore[import-not-found]  # noqa: F401
    except ImportError:
        return False
    return True


def _in_vscode() -> bool:
    return "VSCODE_PID" in os.environ or "VSCODE_IPC_HOOK_CLI" in os.environ


def _has_interactive_ps1() -> bool:
    """``True`` when the plain Python REPL is running.

    ``sys.ps1`` is only defined when CPython's interactive prompt is
    active. Scripts and non-interactive hosts leave it unset.
    """
    return hasattr(sys, "ps1")


@functools.cache
def detect_runtime() -> RuntimeEnv:
    """Classify the current Python process.

    The detection order matters: ZMQ kernels are identified by their
    shell class name, then further refined by checking for
    ``google.colab`` and VSCode environment variables. Terminal IPython
    is recognized by its distinct shell class; remaining cases fall
    back to ``PYTHON_REPL`` vs ``SCRIPT`` based on ``sys.ps1``.

    Cached for the life of the process.
    """
    shell = _get_ipython_shell()
    if shell is None:
        return RuntimeEnv.PYTHON_REPL if _has_interactive_ps1() else RuntimeEnv.SCRIPT

    shell_class = shell.__class__.__name__

    if shell_class == "ZMQInteractiveShell":
        if _has_google_colab():
            return RuntimeEnv.COLAB
        if _in_vscode():
            return RuntimeEnv.VSCODE_NOTEBOOK
        return RuntimeEnv.JUPYTER

    if shell_class == "TerminalInteractiveShell":
        return RuntimeEnv.IPYKERNEL

    # Any other IPython embedded shell — treat as REPL-ish.
    return RuntimeEnv.PYTHON_REPL


_INLINE_RUNTIMES: frozenset[RuntimeEnv] = frozenset(
    {RuntimeEnv.JUPYTER, RuntimeEnv.COLAB, RuntimeEnv.VSCODE_NOTEBOOK}
)
_BROWSER_RUNTIMES: frozenset[RuntimeEnv] = frozenset(
    {RuntimeEnv.SCRIPT, RuntimeEnv.PYTHON_REPL, RuntimeEnv.IPYKERNEL}
)


@functools.cache
def display_surface() -> DisplaySurface:
    """Return the preferred display surface for the current runtime.

    - Notebook hosts with rich-display support get :attr:`DisplaySurface.INLINE`.
    - Scripts and terminal interpreters get :attr:`DisplaySurface.BROWSER`.
    - Any environment where ``MOLVIS_HEADLESS=1`` is exported forces
      :attr:`DisplaySurface.HEADLESS` — useful for CI and automated tests.
    """
    if os.environ.get("MOLVIS_HEADLESS"):
        return DisplaySurface.HEADLESS
    env = detect_runtime()
    if env in _INLINE_RUNTIMES:
        return DisplaySurface.INLINE
    if env in _BROWSER_RUNTIMES:
        return DisplaySurface.BROWSER
    return DisplaySurface.HEADLESS


def is_notebook_host() -> bool:
    """``True`` when the current runtime renders ``text/html`` mimebundles.

    Thin convenience for callers that just want a boolean. Prefer
    :func:`display_surface` when the distinction between ``BROWSER``
    and ``HEADLESS`` matters.
    """
    return detect_runtime() in _INLINE_RUNTIMES


def supports_browser() -> bool:
    """``True`` when opening a standalone browser tab is appropriate.

    Notebook hosts already embed the viewer inline, so opening a
    separate tab would duplicate the display. Headless mode never wants
    a browser.
    """
    return display_surface() is DisplaySurface.BROWSER
