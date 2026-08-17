"""Tests for :mod:`molvis.runtime` environment detection.

Each case patches the helpers used by :func:`detect_runtime` and clears
the cache so the classification picks up the stub. Without the cache
clear the result would be frozen from whichever environment pytest
itself launched in.
"""

from __future__ import annotations

import pytest

from molvis import DisplaySurface, RuntimeEnv, detect_runtime, display_surface
from molvis import runtime as rt


@pytest.fixture(autouse=True)
def _clear_runtime_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    rt.detect_runtime.cache_clear()
    rt.display_surface.cache_clear()
    # Clean env vars that ``detect_runtime`` reads so a Colab-style
    # sniff on the developer's machine doesn't leak into the test.
    monkeypatch.delenv("VSCODE_PID", raising=False)
    monkeypatch.delenv("VSCODE_IPC_HOOK_CLI", raising=False)
    monkeypatch.delenv("MOLVIS_HEADLESS", raising=False)
    yield
    rt.detect_runtime.cache_clear()
    rt.display_surface.cache_clear()


class _ZMQShell:
    __class__ = type("ZMQInteractiveShell", (), {})


class _TerminalShell:
    __class__ = type("TerminalInteractiveShell", (), {})


def _with_shell(
    monkeypatch: pytest.MonkeyPatch,
    shell: object | None,
    *,
    has_colab: bool = False,
) -> None:
    """Install a stub IPython shell + colab detection."""
    monkeypatch.setattr(rt, "_get_ipython_shell", lambda: shell)
    monkeypatch.setattr(rt, "_has_google_colab", lambda: has_colab)


def test_detect_runtime_returns_script_without_ipython(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _with_shell(monkeypatch, None)
    monkeypatch.setattr(rt, "_has_interactive_ps1", lambda: False)
    assert detect_runtime() is RuntimeEnv.SCRIPT


def test_detect_runtime_python_repl_when_ps1_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _with_shell(monkeypatch, None)
    monkeypatch.setattr(rt, "_has_interactive_ps1", lambda: True)
    assert detect_runtime() is RuntimeEnv.PYTHON_REPL


def test_detect_runtime_ipykernel_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _with_shell(monkeypatch, _TerminalShell())
    assert detect_runtime() is RuntimeEnv.IPYKERNEL


def test_detect_runtime_jupyter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _with_shell(monkeypatch, _ZMQShell(), has_colab=False)
    assert detect_runtime() is RuntimeEnv.JUPYTER


def test_detect_runtime_colab_wins_over_jupyter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _with_shell(monkeypatch, _ZMQShell(), has_colab=True)
    assert detect_runtime() is RuntimeEnv.COLAB


def test_detect_runtime_vscode_notebook(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _with_shell(monkeypatch, _ZMQShell(), has_colab=False)
    monkeypatch.setenv("VSCODE_PID", "12345")
    assert detect_runtime() is RuntimeEnv.VSCODE_NOTEBOOK


def test_display_surface_maps_inline_hosts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _with_shell(monkeypatch, _ZMQShell(), has_colab=False)
    assert display_surface() is DisplaySurface.INLINE


def test_display_surface_maps_browser_hosts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _with_shell(monkeypatch, _TerminalShell())
    assert display_surface() is DisplaySurface.BROWSER


def test_display_surface_headless_env_overrides_runtime(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _with_shell(monkeypatch, _ZMQShell(), has_colab=False)
    monkeypatch.setenv("MOLVIS_HEADLESS", "1")
    assert display_surface() is DisplaySurface.HEADLESS


def test_is_notebook_host_and_supports_browser(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _with_shell(monkeypatch, _ZMQShell(), has_colab=False)
    assert rt.is_notebook_host() is True
    assert rt.supports_browser() is False

    rt.detect_runtime.cache_clear()
    rt.display_surface.cache_clear()
    _with_shell(monkeypatch, None)
    monkeypatch.setattr(rt, "_has_interactive_ps1", lambda: False)
    assert rt.is_notebook_host() is False
    assert rt.supports_browser() is True


def test_detect_runtime_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    _with_shell(monkeypatch, _ZMQShell(), has_colab=False)
    first = detect_runtime()
    # Flip the stub — cache should keep the old answer.
    _with_shell(monkeypatch, _TerminalShell())
    second = detect_runtime()
    assert first is second is RuntimeEnv.JUPYTER


def test_runtime_env_values_are_stable() -> None:
    """Stringly-typed values are part of the public session_info dict,
    so adding a new variant must not reshuffle existing ones."""
    assert RuntimeEnv.SCRIPT.value == "script"
    assert RuntimeEnv.PYTHON_REPL.value == "python_repl"
    assert RuntimeEnv.IPYKERNEL.value == "ipykernel"
    assert RuntimeEnv.JUPYTER.value == "jupyter"
    assert RuntimeEnv.COLAB.value == "colab"
    assert RuntimeEnv.VSCODE_NOTEBOOK.value == "vscode_notebook"

    assert DisplaySurface.INLINE.value == "inline"
    assert DisplaySurface.BROWSER.value == "browser"
    assert DisplaySurface.HEADLESS.value == "headless"
