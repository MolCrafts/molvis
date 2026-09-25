"""molvis's own MCP surface: a live viewer session an agent can drive.

The protocol layer is :mod:`molvis.mcp.server` and needs FastMCP
(``pip install "molcrafts-molvis[mcp]"``). Everything it exposes is
implemented in :mod:`molvis.mcp.workbench` and :mod:`molvis.mcp.reload`,
which import no MCP machinery at all — so the behaviour is testable, and
usable from a notebook, without a server anywhere.

Names resolve lazily for that reason: ``from molvis.mcp import Workbench``
must not pull FastMCP into a process that only wants the session store.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "RefreshReport",
    "Workbench",
    "build_server",
    "main",
    "refresh_modules",
]

_LAZY: dict[str, tuple[str, str]] = {
    "Workbench": (".workbench", "Workbench"),
    "RefreshReport": (".reload", "RefreshReport"),
    "refresh_modules": (".reload", "refresh_modules"),
    "build_server": (".server", "build_server"),
    "main": (".server", "main"),
}


def __getattr__(name: str) -> Any:
    """Import the module that owns *name* on first access.

    Parameters
    ----------
    name
        Attribute requested on this package.

    Returns
    -------
    Any
        The requested object, cached into the module globals so the import
        happens once.

    Raises
    ------
    AttributeError
        The name is not part of this package's surface.
    """
    target = _LAZY.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module_name, attribute = target
    from importlib import import_module

    value = getattr(import_module(module_name, __name__), attribute)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    """List this package's surface, lazy names included."""
    return sorted(__all__)
