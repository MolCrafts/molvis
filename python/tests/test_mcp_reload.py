"""Tests for molvis.mcp.reload: what a refresh purges, and what it admits it cannot."""

from __future__ import annotations

import sys
import types
from typing import Any

import pytest

from molvis.mcp.reload import DEFAULT_PREFIXES, refresh_modules


def _fake_module(name: str, origin: str) -> types.ModuleType:
    """A module object whose spec claims it came from *origin*."""
    module = types.ModuleType(name)
    module.__spec__ = types.SimpleNamespace(origin=origin)  # type: ignore[assignment]
    return module


@pytest.fixture
def planted(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Install fake modules in ``sys.modules`` and remove them afterwards."""

    def _plant(name: str, origin: str) -> types.ModuleType:
        module = _fake_module(name, origin)
        monkeypatch.setitem(sys.modules, name, module)
        return module

    return _plant


def test_a_pure_python_module_is_purged(planted: Any) -> None:
    planted("fakesci", "/tmp/fakesci/__init__.py")
    planted("fakesci.io", "/tmp/fakesci/io.py")

    report = refresh_modules(("fakesci",)).as_dict()

    assert report["ok"] is True
    assert report["purged"] == ["fakesci", "fakesci.io"]
    assert "fakesci" not in sys.modules


def test_an_unrelated_module_is_left_alone(planted: Any) -> None:
    planted("fakesci", "/tmp/fakesci/__init__.py")
    planted("otherpkg", "/tmp/otherpkg/__init__.py")

    refresh_modules(("fakesci",))

    assert "otherpkg" in sys.modules


def test_a_prefix_match_is_on_the_module_boundary(planted: Any) -> None:
    planted("fakesci", "/tmp/fakesci/__init__.py")
    planted("fakescience", "/tmp/fakescience/__init__.py")

    report = refresh_modules(("fakesci",)).as_dict()

    assert report["purged"] == ["fakesci"]
    assert "fakescience" in sys.modules


def test_a_compiled_extension_is_reported_not_purged(planted: Any) -> None:
    planted("fakesci", "/tmp/fakesci/__init__.py")
    planted("fakesci._core", "/tmp/fakesci/_core.cpython-312-x86_64-linux-gnu.so")

    report = refresh_modules(("fakesci",)).as_dict()

    assert report["restart_required"] == ["fakesci._core"]
    assert report["ok"] is False
    assert "fakesci._core" in sys.modules


def test_a_stdlib_prefix_is_refused_and_stays_imported() -> None:
    report = refresh_modules(("json",)).as_dict()

    assert report["refused"] == ["json"]
    assert report["purged"] == []
    assert "json" in sys.modules


def test_refusing_one_prefix_does_not_block_the_others(planted: Any) -> None:
    planted("fakesci", "/tmp/fakesci/__init__.py")

    report = refresh_modules(("json", "fakesci")).as_dict()

    assert report["refused"] == ["json"]
    assert report["purged"] == ["fakesci"]


def test_nothing_imported_under_a_prefix_is_not_an_error() -> None:
    report = refresh_modules(("nevereverimported",)).as_dict()

    assert report == {
        "ok": True,
        "purged": [],
        "restart_required": [],
        "refused": [],
    }


def test_the_default_prefixes_are_the_stack_an_agent_edits() -> None:
    assert DEFAULT_PREFIXES == ("molpy", "molvis")
