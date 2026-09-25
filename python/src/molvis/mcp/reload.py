"""Re-read edited packages inside a live workbench process.

Why this exists
---------------

An agent edits a package on disk and expects the next ``run`` call to
execute the new code. That holds for pure Python: dropping a module from
:data:`sys.modules` makes the next import re-read the source. It does **not**
hold for a compiled extension (``.so`` / ``.pyd`` / ``.dylib``) — the dynamic
loader maps it once per process and CPython offers no way to swap it. Only a
new process picks up that rebuild.

Reporting the difference is the whole point of this module. A refresh that
silently leaves a stale extension mapped is worse than no refresh: the agent
then exercises the old behaviour, reports it as the new one, and the operator
trusts a verdict about code that never ran. So :func:`refresh_modules` always
answers with three lists — what it purged, what it cannot purge, and what it
refused to touch.

No MCP machinery here either; :mod:`molvis.mcp.server` only wires it up.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field

#: Prefixes a refresh will never purge. Dropping a standard-library module
#: does not reload it for anybody: every module that already imported it
#: keeps the old module object while a re-import installs a new one, so the
#: two stop sharing classes and an ``except json.JSONDecodeError`` elsewhere
#: in the process quietly stops matching. That is corruption wearing a
#: refresh's clothes.
REFUSED_PREFIXES: frozenset[str] = frozenset(sys.stdlib_module_names)

#: The molecular stack an agent edits between calls. Callers may name others.
DEFAULT_PREFIXES: tuple[str, ...] = ("molpy", "molvis")

#: Suffixes that mark a module as loaded from a compiled extension.
_EXTENSION_SUFFIXES: tuple[str, ...] = (".so", ".pyd", ".dylib")


@dataclass
class RefreshReport:
    """What one :func:`refresh_modules` call did.

    Attributes
    ----------
    purged
        Modules dropped from :data:`sys.modules`; the next import re-reads
        their source.
    restart_required
        Modules backed by a compiled extension, left mapped. While this is
        non-empty, some of the code the agent is about to exercise is still
        the old build.
    refused
        Prefixes skipped because they name standard-library modules.
    """

    purged: list[str] = field(default_factory=list)
    restart_required: list[str] = field(default_factory=list)
    refused: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        """Render the report for a tool result.

        Returns
        -------
        dict
            The three lists plus ``ok``, which is false exactly when a
            restart is required — the one case where a caller must not
            believe it is running new code.
        """
        return {
            "ok": not self.restart_required,
            "purged": sorted(self.purged),
            "restart_required": sorted(self.restart_required),
            "refused": sorted(self.refused),
        }


def refresh_modules(prefixes: tuple[str, ...] = DEFAULT_PREFIXES) -> RefreshReport:
    """Drop pure-Python modules under *prefixes* so the next import re-reads them.

    Live objects are not migrated. A scene, a parsed molecule, anything an
    earlier ``run`` bound in the namespace keeps pointing at the classes it
    was built from, so a session that refreshes a package whose objects are
    still in use straddles two versions of it. Rebuild those objects
    afterwards, or open a new session.

    Parameters
    ----------
    prefixes
        Top-level module names to refresh, e.g. ``("molpy",)``.

    Returns
    -------
    RefreshReport
        ``restart_required`` is the field that matters.
    """
    report = RefreshReport()
    wanted: list[str] = []
    for prefix in prefixes:
        head = prefix.split(".", 1)[0]
        if head in REFUSED_PREFIXES:
            report.refused.append(prefix)
            continue
        wanted.append(prefix)
    if not wanted:
        return report

    for name, module in list(sys.modules.items()):
        if not any(name == p or name.startswith(f"{p}.") for p in wanted):
            continue
        if _is_extension(module):
            report.restart_required.append(name)
            continue
        del sys.modules[name]
        report.purged.append(name)
    return report


def _is_extension(module: object) -> bool:
    """Whether *module* was loaded from a compiled extension file."""
    origin = getattr(getattr(module, "__spec__", None), "origin", None)
    if not isinstance(origin, str):
        return False
    return origin.endswith(_EXTENSION_SUFFIXES)


__all__ = [
    "DEFAULT_PREFIXES",
    "REFUSED_PREFIXES",
    "RefreshReport",
    "refresh_modules",
]
