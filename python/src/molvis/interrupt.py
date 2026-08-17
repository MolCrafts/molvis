"""Cooperative interrupt flag for long-running notebook cells.

Hosts (Pyodide plugin Interrupt button, future Jupyter kernels) set the
flag via :func:`request`. Call sites that can yield — demo step delays,
``send_cmd`` entry, style/theme RPCs — call :func:`check` so the cell
stops at the next safe boundary without SIGINT into the webloop.

Under Pyodide, the Interrupt button **must not rely solely** on re-entering
Python while the cell is blocked in ``run_sync``: that re-entry often never
runs. The host therefore also exposes a **pure-JS** flag on
``molvis_kernel_ctl``; :func:`check` / :func:`requested` poll it so a
blocked wait loop can still abort within one poll tick.
"""

from __future__ import annotations

__all__ = [
    "InterruptRequested",
    "check",
    "clear",
    "request",
    "requested",
]

_interrupted = False


class InterruptRequested(Exception):
    """The host asked to stop the current cell / script."""

    def __init__(self, message: str = "Interrupted by user") -> None:
        super().__init__(message)


def _host_flag() -> bool:
    """Read the JS-side interrupt latch when present (Pyodide plugin)."""
    try:
        import molvis_kernel_ctl  # type: ignore[import-not-found]
    except ImportError:
        return False
    probe = getattr(molvis_kernel_ctl, "is_interrupt_requested", None)
    if probe is None:
        return False
    try:
        return bool(probe())
    except Exception:  # noqa: BLE001 — host glue must never crash user code
        return False


def request() -> None:
    """Mark the current cell as interrupted (idempotent)."""
    global _interrupted
    _interrupted = True
    # Mirror onto the host latch when available so other pollers agree.
    try:
        import molvis_kernel_ctl  # type: ignore[import-not-found]

        set_flag = getattr(molvis_kernel_ctl, "request_interrupt", None)
        if callable(set_flag):
            set_flag()
    except Exception:  # noqa: BLE001
        pass


def clear() -> None:
    """Clear the interrupt flag (call when a new cell starts)."""
    global _interrupted
    _interrupted = False
    try:
        import molvis_kernel_ctl  # type: ignore[import-not-found]

        clear_flag = getattr(molvis_kernel_ctl, "clear_interrupt", None)
        if callable(clear_flag):
            clear_flag()
    except Exception:  # noqa: BLE001
        pass


def requested() -> bool:
    """Return whether an interrupt is pending (Python flag or host latch)."""
    global _interrupted
    if _interrupted:
        return True
    if _host_flag():
        _interrupted = True
        return True
    return False


def check() -> None:
    """Raise :class:`InterruptRequested` if interrupt is pending."""
    if requested():
        raise InterruptRequested()
