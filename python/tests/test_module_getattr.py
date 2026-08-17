"""Top-level :mod:`molvis` namespace."""

from __future__ import annotations

import importlib

import molvis
from molvis import Stage


def test_submodules_import_cleanly() -> None:
    """`from molvis import <submodule>` needs no viewer and no magic.

    Regression: a module-level __getattr__ used to forward unknown names to
    a global "current stage" and raise RuntimeError when none existed. The
    import machinery probes with ``hasattr``, which only swallows
    AttributeError, so that RuntimeError aborted these imports outright.
    """
    for name in ("structure", "transport", "types"):
        assert getattr(molvis, name) is importlib.import_module(f"molvis.{name}")
    assert importlib.import_module("molvis.transport.base") is not None


def test_unknown_name_is_a_plain_attribute_error() -> None:
    try:
        molvis.definitely_not_a_module_or_method
    except AttributeError as exc:
        assert "molvis" in str(exc)
    else:  # pragma: no cover — the attribute must not resolve
        raise AssertionError("expected AttributeError")


def test_public_exports_resolve() -> None:
    assert molvis.Stage is Stage
    for name in molvis.__all__:
        assert hasattr(molvis, name), name
