"""Setuptools entry point and PEP 517 wrapper for MolVis.

``WebSocketTransport`` serves ``src/molvis/dist/`` on its own HTTP port
(see :func:`molvis.transport.resolve_dist`). That directory is not source —
it is a *copy* of ``page/dist/`` made by the root ``npm run build:page``
script, and it is gitignored. Layout is flat under ``dist/`` (``js/``,
``css/``, ``wasm/``) — not ``dist/static/``. Building a wheel, or an editable
install, from the source tree without refreshing it ships whatever bundle
happened to be lying around.

This wrapper refreshes it before setuptools packages anything. It stays out
of the way unless every one of these holds:

* the build root is the molvis source tree — detected by a sibling
  ``package.json`` one level up. An sdist or a PyPI wheel unpacks without
  it, so installing molvis from an index never needs Node.
* ``npm`` is on ``PATH``.
* the copy under ``src/molvis/dist/`` is missing, or older than the newest
  file under a frontend workspace's ``src/``.

Escape hatches: ``MOLVIS_SKIP_UI_BUILD=1`` skips the build entirely;
``MOLVIS_FORCE_UI_BUILD=1`` runs it even when the copy looks current.

Note this fires at *install* time only. Day-to-day TS edits use
``npm run dev:python`` (watch rebuild into ``src/molvis/dist/``) or a
one-shot ``npm run build:page``.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path

from setuptools import build_meta as _setuptools_build_meta
from setuptools import setup as _setuptools_setup

ConfigValue = str | Sequence[str]
ConfigSettings = Mapping[str, ConfigValue] | None

_ROOT = Path(__file__).resolve().parent
_REPO_ROOT = _ROOT.parent

#: Workspaces whose ``src/`` feeds the page bundle, relative to the repo root.
FRONTEND_WORKSPACES = ("core", "stage", "sketch", "umbrella", "page")

#: Root npm script that builds ``page/dist`` and copies it into the package.
BUILD_SCRIPT = "build:page"

#: Directory trees never worth scanning for source mtimes.
SKIPPED_DIRS = frozenset({"node_modules", "dist", ".turbo", "__pycache__"})

TRUTHY = frozenset({"1", "true", "yes", "on"})

_UI_BUILT = False


def _flag(name: str) -> bool:
    """Read a boolean opt-in/opt-out environment variable."""
    return os.environ.get(name, "").strip().lower() in TRUTHY


def _newest_mtime(root: Path) -> float:
    """Latest mtime under *root*, skipping build output. 0.0 when absent."""
    if not root.is_dir():
        return 0.0
    newest = 0.0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIPPED_DIRS]
        for filename in filenames:
            try:
                mtime = (Path(dirpath) / filename).stat().st_mtime
            except OSError:
                continue
            newest = max(newest, mtime)
    return newest


def _source_mtime() -> float:
    """Latest mtime across every frontend workspace's ``src/``."""
    return max(
        (_newest_mtime(_REPO_ROOT / name / "src") for name in FRONTEND_WORKSPACES),
        default=0.0,
    )


def _bundle_mtime() -> float:
    """Build time of the packaged bundle, or 0.0 when it is absent."""
    try:
        return (_ROOT / "src" / "molvis" / "dist" / "index.html").stat().st_mtime
    except OSError:
        return 0.0


def _skip_reason() -> str | None:
    """Why this build should not run npm, or ``None`` to go ahead."""
    if _flag("MOLVIS_SKIP_UI_BUILD"):
        return "MOLVIS_SKIP_UI_BUILD is set"
    if not (_REPO_ROOT / "package.json").is_file():
        return "not a source checkout"
    if shutil.which("npm") is None:
        return "npm not on PATH"
    if _flag("MOLVIS_FORCE_UI_BUILD"):
        return None
    if _bundle_mtime() >= _source_mtime():
        return "bundle is current"
    return None


def _maybe_build_ui() -> None:
    """Run ``npm run build:page`` once per process when the bundle is stale."""
    global _UI_BUILT
    if _UI_BUILT:
        return
    reason = _skip_reason()
    if reason is not None:
        print(f"molvis: skipping page build ({reason})")
        _UI_BUILT = True
        return
    print(f"molvis: npm run {BUILD_SCRIPT} (page bundle is stale)")
    subprocess.run(["npm", "run", BUILD_SCRIPT], cwd=_REPO_ROOT, check=True)  # noqa: S603,S607
    _UI_BUILT = True


def _clean_build_dir() -> None:
    shutil.rmtree(_ROOT / "build", ignore_errors=True)


def get_requires_for_build_wheel(config_settings: ConfigSettings = None) -> list[str]:
    return _setuptools_build_meta.get_requires_for_build_wheel(config_settings)


def get_requires_for_build_sdist(config_settings: ConfigSettings = None) -> list[str]:
    return _setuptools_build_meta.get_requires_for_build_sdist(config_settings)


def get_requires_for_build_editable(config_settings: ConfigSettings = None) -> list[str]:
    return _setuptools_build_meta.get_requires_for_build_editable(config_settings)


def prepare_metadata_for_build_wheel(
    metadata_directory: str,
    config_settings: ConfigSettings = None,
) -> str:
    return _setuptools_build_meta.prepare_metadata_for_build_wheel(
        metadata_directory,
        config_settings,
    )


def build_wheel(
    wheel_directory: str,
    config_settings: ConfigSettings = None,
    metadata_directory: str | None = None,
) -> str:
    _maybe_build_ui()
    _clean_build_dir()
    return _setuptools_build_meta.build_wheel(
        wheel_directory,
        config_settings,
        metadata_directory,
    )


def build_sdist(
    sdist_directory: str,
    config_settings: ConfigSettings = None,
) -> str:
    _maybe_build_ui()
    _clean_build_dir()
    return _setuptools_build_meta.build_sdist(sdist_directory, config_settings)


def build_editable(
    wheel_directory: str,
    config_settings: ConfigSettings = None,
    metadata_directory: str | None = None,
) -> str:
    _maybe_build_ui()
    _clean_build_dir()
    return _setuptools_build_meta.build_editable(
        wheel_directory,
        config_settings,
        metadata_directory,
    )


def __getattr__(name: str) -> object:
    return getattr(_setuptools_build_meta, name)


if __name__ == "__main__":
    _setuptools_setup()
