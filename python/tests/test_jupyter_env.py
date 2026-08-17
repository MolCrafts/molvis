"""Unit tests for transport._jupyter_env URL detection.

This module is now a thin URL-resolution layer on top of
:mod:`molvis.runtime`. The tests stub the runtime detection to exercise
the four URL-reachability branches (colab / jupyter_proxy / vscode /
local) without mutating global env vars or shell objects.
"""

from __future__ import annotations

import pytest

from molvis import RuntimeEnv
from molvis import runtime as rt


@pytest.fixture(autouse=True)
def _clear_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    from molvis.transport import _jupyter_env

    _jupyter_env.detect_env.cache_clear()
    rt.detect_runtime.cache_clear()
    rt.display_surface.cache_clear()
    monkeypatch.delenv("VSCODE_PID", raising=False)
    monkeypatch.delenv("VSCODE_IPC_HOOK_CLI", raising=False)
    monkeypatch.delenv("JUPYTERHUB_SERVICE_PREFIX", raising=False)
    monkeypatch.delenv("JUPYTER_SERVER_URL", raising=False)
    yield
    # Undo monkeypatches before touching caches — a test that replaced
    # ``rt.detect_runtime`` with a plain lambda leaves no ``cache_clear``
    # attribute; ``monkeypatch.undo()`` restores the real functools-cache
    # wrapper so the clearing below can't ``AttributeError``.
    monkeypatch.undo()
    _jupyter_env.detect_env.cache_clear()
    rt.detect_runtime.cache_clear()
    rt.display_surface.cache_clear()


def _pin_runtime(monkeypatch: pytest.MonkeyPatch, runtime: RuntimeEnv) -> None:
    """Force :func:`molvis.runtime.detect_runtime` to return *runtime*."""
    monkeypatch.setattr(rt, "detect_runtime", lambda: runtime)
    from molvis.transport import _jupyter_env

    monkeypatch.setattr(_jupyter_env, "detect_runtime", lambda: runtime)


def test_local_endpoints_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """Outside any kernel we expect plain localhost URLs."""
    from molvis.transport._jupyter_env import resolve_endpoints

    _pin_runtime(monkeypatch, RuntimeEnv.SCRIPT)

    base, ws = resolve_endpoints("localhost", 5000)
    assert base == "http://localhost:5000/"
    assert ws == "ws://localhost:5000/ws"


def test_jupyter_proxy_prefix_is_honoured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When jupyter-server-proxy is available the URL is prefixed."""
    from molvis.transport import _jupyter_env

    _pin_runtime(monkeypatch, RuntimeEnv.JUPYTER)
    monkeypatch.setattr(_jupyter_env, "_has_jupyter_server_proxy", lambda: True)
    monkeypatch.setenv("JUPYTERHUB_SERVICE_PREFIX", "/user/me/")

    base, ws = _jupyter_env.resolve_endpoints("localhost", 4242)
    assert base == "/user/me/proxy/4242/"
    assert ws == "/user/me/proxy/4242/ws"


def test_vscode_remote_uses_local_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """VSCode auto-forwards localhost ports — plain URL is fine."""
    from molvis.transport import _jupyter_env

    _pin_runtime(monkeypatch, RuntimeEnv.VSCODE_NOTEBOOK)

    assert _jupyter_env.detect_env() == "vscode"
    base, ws = _jupyter_env.resolve_endpoints("127.0.0.1", 7000)
    assert base == "http://127.0.0.1:7000/"
    assert ws == "ws://127.0.0.1:7000/ws"


def test_colab_returns_proxy_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from molvis.transport import _jupyter_env

    _pin_runtime(monkeypatch, RuntimeEnv.COLAB)
    assert _jupyter_env.detect_env() == "colab"
    base, ws = _jupyter_env.resolve_endpoints("localhost", 9000)
    assert base == "/proxy/9000/"
    assert ws.startswith("wss://_/proxy/9000/")


def test_detect_env_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    from molvis.transport._jupyter_env import detect_env

    _pin_runtime(monkeypatch, RuntimeEnv.SCRIPT)
    first = detect_env()
    second = detect_env()
    assert first == second
