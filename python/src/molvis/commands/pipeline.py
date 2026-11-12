"""Pipeline commands for :class:`Molvis`.

Mirrors the React pipeline sidebar so a Python controller can inspect and
mutate the modifier pipeline (add / remove / reorder / toggle) without
scraping the DOM. Every method forwards to a ``pipeline.*`` JSON-RPC
method that the frontend's :class:`RPCRouter` dispatches into
``MolvisApp.modifierPipeline``.

Design contract: *both* the GUI sidebar and these commands operate on the
same ``ModifierPipeline`` instance. Adding a modifier from Python is
indistinguishable from clicking "+" in the sidebar — same events, same
redraw path, same undo semantics.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from .catalog import FrontendCommands

if TYPE_CHECKING:
    from ..scene import Molvis

logger = logging.getLogger("molvis")

__all__ = ["AvailableModifier", "Modifier", "ModifierInfo", "PipelineCommandsMixin"]


@dataclass(frozen=True)
class ModifierInfo:
    """Snapshot of a single modifier in the frontend pipeline."""

    id: str
    name: str
    category: str
    enabled: bool
    selection_scope_id: str | None
    source_owner_id: str | None
    kind: str | None = None


@dataclass(frozen=True)
class AvailableModifier:
    """A modifier type registered in the frontend's ``ModifierRegistry``."""

    name: str
    category: str


def _to_modifier_info(raw: Any) -> ModifierInfo:
    data = raw if isinstance(raw, dict) else {}
    return ModifierInfo(
        id=str(data.get("id") or ""),
        name=str(data.get("name") or ""),
        category=str(data.get("category") or ""),
        enabled=bool(data.get("enabled", True)),
        selection_scope_id=data.get("selection_scope_id"),
        source_owner_id=data.get("source_owner_id"),
        kind=data.get("kind") if isinstance(data.get("kind"), str) else None,
    )


class Modifier:
    """A handle on one modifier in a scene's pipeline.

    Get one with :meth:`Molvis.get_modifier`. The handle names the modifier
    by id; its :attr:`info` is the snapshot taken when the handle was made.

    Example::

        surface = scene.get_modifier("Molecular surface")
        surface.set_params(algorithm="ses", solvent={"domain": "cell"})
    """

    def __init__(self, scene: Molvis, info: ModifierInfo) -> None:
        self._scene = scene
        self.info = info
        #: What the modifier reported on its last :meth:`set_params` run, or
        #: ``None`` (no run yet, or a modifier that reports nothing).
        self.report: dict[str, Any] | None = None

    @property
    def id(self) -> str:
        return self.info.id

    @property
    def name(self) -> str:
        return self.info.name

    def set_params(self, *, timeout: float = 30.0, **params: Any) -> dict[str, Any]:
        """Set parameters and return the modifier's full record after the change.

        Keys are the modifier's saved-project record (what the stage's
        ``toProjectParams`` writes), merged over its current values: keys
        left out keep their value, and a nested record is read field by
        field, so ``solvent={"domain": "cell"}`` changes only that field.
        The stage drops unknown or invalid values; the returned record shows
        what it accepted.

        The pipeline re-runs before the reply, so a surface or other geometry
        is ready to snapshot when this returns. A modifier that reports on its
        run (a surface: its grid, and for a void surface its pores) leaves
        that report in :attr:`report`.

        Raises:
            molvis.MolvisRPCError: The modifier is gone, or has no settable
                parameters.
        """
        data = self._scene.send_cmd(
            FrontendCommands.PIPELINE_SET_PARAMS.method,
            {"id": self.id, "params": params},
            wait_for_response=True,
            timeout=timeout,
        )
        self._scene.list_modifiers()
        if not isinstance(data, dict):
            self.report = None
            return {}
        report = data.get("report")
        self.report = dict(report) if isinstance(report, dict) else None
        return dict(data.get("params", {}))

    def __repr__(self) -> str:
        return f"Modifier(id={self.id!r}, name={self.name!r})"


class PipelineCommandsMixin:
    """Mixin class providing modifier pipeline CRUD for :class:`Molvis`.

    Every mutation waits for the frontend's response and then refreshes
    the local pipeline mirror by calling :meth:`list_modifiers`. This
    keeps Python's ``_mirror_pipeline`` byte-for-byte aligned with what
    the frontend renders — the mirror is what gets replayed on a WS
    reconnect via :meth:`Molvis._send_state_sync_snapshot`.
    """

    def list_modifiers(self: Molvis, timeout: float = 5.0) -> list[ModifierInfo]:
        """Return the ordered list of modifiers currently in the pipeline.

        Also refreshes the Python-side mirror used for state sync on
        reconnect. Safe to call from user code at any time.
        """
        data = self.send_cmd(
            FrontendCommands.PIPELINE_LIST.method,
            {},
            wait_for_response=True,
            timeout=timeout,
        )
        raw_list = data.get("modifiers", []) if isinstance(data, dict) else []
        entries = [_to_modifier_info(entry) for entry in raw_list]
        self._record_pipeline(entries)
        return entries

    def get_modifier(self: Molvis, key: str, *, timeout: float = 5.0) -> Modifier:
        """The pipeline modifier whose id, or else whose name, is *key*.

        Raises:
            KeyError: No modifier has that id or name.
            ValueError: Several modifiers share that name; pass an id.
        """
        modifiers = self.list_modifiers(timeout=timeout)
        found = [m for m in modifiers if m.id == key] or [
            m for m in modifiers if m.name == key
        ]
        if not found:
            names = ", ".join(f"{m.name} ({m.id})" for m in modifiers)
            raise KeyError(
                f"no modifier with id or name {key!r}; the pipeline has: {names}"
            )
        if len(found) > 1:
            ids = ", ".join(m.id for m in found)
            raise ValueError(
                f"{len(found)} modifiers are named {key!r} ({ids}); pass an id"
            )
        return Modifier(self, found[0])

    def available_modifiers(
        self: Molvis, timeout: float = 5.0
    ) -> list[AvailableModifier]:
        """Return every modifier type registered in the frontend registry."""
        data = self.send_cmd(
            FrontendCommands.PIPELINE_AVAILABLE_MODIFIERS.method,
            {},
            wait_for_response=True,
            timeout=timeout,
        )
        raw_list = data.get("modifiers", []) if isinstance(data, dict) else []
        return [
            AvailableModifier(name=str(e["name"]), category=str(e["category"]))
            for e in raw_list
        ]

    def add_modifier(
        self: Molvis,
        name: str,
        *,
        selection_scope_id: str | None = None,
        source_owner_id: str | None = None,
        enabled: bool | None = None,
        timeout: float = 5.0,
    ) -> Molvis:
        """Append a modifier to the pipeline.

        The new modifier's info is stored on ``self.last_modifier``
        (a :class:`ModifierInfo`). Returns ``self`` for chaining.

        Args:
            name: Registry name of the modifier type (e.g. ``"Slice"``,
                ``"Hide Selection"``, ``"Expression Select"``). Match the
                labels surfaced by :meth:`available_modifiers`.
            selection_scope_id: Optional selection-producing modifier id.
            source_owner_id: Optional source id for tree ownership.
            enabled: Override the default ``enabled=True`` on creation.

        Raises:
            molvis.MolvisRPCError: If the registry lookup fails or the
                pipeline rejects the requested scope/owner/enabled combination.
        """
        params: dict[str, Any] = {"name": name}
        if selection_scope_id is not None:
            params["selection_scope_id"] = selection_scope_id
        if source_owner_id is not None:
            params["source_owner_id"] = source_owner_id
        if enabled is not None:
            params["enabled"] = enabled
        data = self.send_cmd(
            FrontendCommands.PIPELINE_ADD_MODIFIER.method,
            params,
            wait_for_response=True,
            timeout=timeout,
        )
        modifier = (data.get("modifier") if isinstance(data, dict) else None) or {}
        info = _to_modifier_info(modifier)
        self.last_modifier = info  # type: ignore[attr-defined]
        self.list_modifiers(timeout=timeout)
        return self

    def remove_modifier(
        self: Molvis, modifier_id: str, *, timeout: float = 5.0
    ) -> Molvis:
        """Remove a modifier and its descendants.

        Removed ids are stored on ``self.last_removed_ids``. Returns ``self``.
        """
        data = self.send_cmd(
            FrontendCommands.PIPELINE_REMOVE_MODIFIER.method,
            {"id": modifier_id},
            wait_for_response=True,
            timeout=timeout,
        )
        removed = data.get("removed_ids", []) if isinstance(data, dict) else []
        self.last_removed_ids = [str(x) for x in removed]  # type: ignore[attr-defined]
        self.list_modifiers(timeout=timeout)
        return self

    def reorder_modifier(
        self: Molvis,
        modifier_id: str,
        new_index: int,
        *,
        timeout: float = 5.0,
    ) -> Molvis:
        """Move a modifier to a new position in the pipeline array."""
        self.send_cmd(
            FrontendCommands.PIPELINE_REORDER_MODIFIER.method,
            {"id": modifier_id, "new_index": int(new_index)},
            wait_for_response=True,
            timeout=timeout,
        )
        self.list_modifiers(timeout=timeout)
        return self

    def set_modifier_enabled(
        self: Molvis,
        modifier_id: str,
        enabled: bool,
        *,
        timeout: float = 5.0,
    ) -> Molvis:
        """Toggle a single modifier on/off without reordering."""
        self.send_cmd(
            FrontendCommands.PIPELINE_SET_ENABLED.method,
            {"id": modifier_id, "enabled": bool(enabled)},
            wait_for_response=True,
            timeout=timeout,
        )
        self.list_modifiers(timeout=timeout)
        return self

    def set_modifier_selection_scope(
        self: Molvis,
        modifier_id: str,
        selection_scope_id: str | None,
        *,
        timeout: float = 5.0,
    ) -> Molvis:
        """Set the selection scope consumed by a modifier, or detach it."""
        self.send_cmd(
            FrontendCommands.PIPELINE_SET_SELECTION_SCOPE.method,
            {"id": modifier_id, "selection_scope_id": selection_scope_id},
            wait_for_response=True,
            timeout=timeout,
        )
        self.list_modifiers(timeout=timeout)
        return self

    def set_modifier_source_owner(
        self: Molvis,
        modifier_id: str,
        source_owner_id: str | None,
        *,
        timeout: float = 5.0,
    ) -> Molvis:
        """Set source tree ownership for a modifier, or detach it."""
        self.send_cmd(
            FrontendCommands.PIPELINE_SET_SOURCE_OWNER.method,
            {"id": modifier_id, "source_owner_id": source_owner_id},
            wait_for_response=True,
            timeout=timeout,
        )
        self.list_modifiers(timeout=timeout)
        return self

    def clear_pipeline(self: Molvis, *, timeout: float = 5.0) -> Molvis:
        """Remove every modifier from the pipeline."""
        self.send_cmd(
            FrontendCommands.PIPELINE_CLEAR.method,
            {},
            wait_for_response=True,
            timeout=timeout,
        )
        self._clear_mirror()
        return self
