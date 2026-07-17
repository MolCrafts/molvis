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

__all__ = ["PipelineCommandsMixin", "ModifierInfo", "AvailableModifier"]


@dataclass(frozen=True)
class ModifierInfo:
    """Snapshot of a single modifier in the frontend pipeline."""

    id: str
    name: str
    category: str
    enabled: bool
    selection_scope_id: str | None
    source_owner_id: str | None


@dataclass(frozen=True)
class AvailableModifier:
    """A modifier type registered in the frontend's ``ModifierRegistry``."""

    name: str
    category: str


def _to_modifier_info(raw: Any) -> ModifierInfo:
    return ModifierInfo(
        id=str(raw["id"]),
        name=str(raw["name"]),
        category=str(raw["category"]),
        enabled=bool(raw["enabled"]),
        selection_scope_id=raw.get("selection_scope_id"),
        source_owner_id=raw.get("source_owner_id"),
    )


class PipelineCommandsMixin:
    """Mixin class providing modifier pipeline CRUD for :class:`Molvis`.

    Every mutation waits for the frontend's response and then refreshes
    the local pipeline mirror by calling :meth:`list_modifiers`. This
    keeps Python's ``_mirror_pipeline`` byte-for-byte aligned with what
    the frontend renders — the mirror is what gets replayed on a WS
    reconnect via :meth:`Molvis._send_state_sync_snapshot`.
    """

    def list_modifiers(self: "Molvis", timeout: float = 5.0) -> list[ModifierInfo]:
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

    def available_modifiers(
        self: "Molvis", timeout: float = 5.0
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
        self: "Molvis",
        name: str,
        *,
        selection_scope_id: str | None = None,
        source_owner_id: str | None = None,
        enabled: bool | None = None,
        timeout: float = 5.0,
    ) -> ModifierInfo:
        """Append a modifier to the pipeline and return its assigned info.

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
        modifier = (
            data.get("modifier") if isinstance(data, dict) else None
        ) or {}
        info = _to_modifier_info(modifier)
        self.list_modifiers(timeout=timeout)
        return info

    def remove_modifier(
        self: "Molvis", modifier_id: str, *, timeout: float = 5.0
    ) -> list[str]:
        """Remove a modifier and its descendants. Returns the removed ids."""
        data = self.send_cmd(
            FrontendCommands.PIPELINE_REMOVE_MODIFIER.method,
            {"id": modifier_id},
            wait_for_response=True,
            timeout=timeout,
        )
        removed = (
            data.get("removed_ids", []) if isinstance(data, dict) else []
        )
        self.list_modifiers(timeout=timeout)
        return [str(x) for x in removed]

    def reorder_modifier(
        self: "Molvis",
        modifier_id: str,
        new_index: int,
        *,
        timeout: float = 5.0,
    ) -> "Molvis":
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
        self: "Molvis",
        modifier_id: str,
        enabled: bool,
        *,
        timeout: float = 5.0,
    ) -> "Molvis":
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
        self: "Molvis",
        modifier_id: str,
        selection_scope_id: str | None,
        *,
        timeout: float = 5.0,
    ) -> "Molvis":
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
        self: "Molvis",
        modifier_id: str,
        source_owner_id: str | None,
        *,
        timeout: float = 5.0,
    ) -> "Molvis":
        """Set source tree ownership for a modifier, or detach it."""
        self.send_cmd(
            FrontendCommands.PIPELINE_SET_SOURCE_OWNER.method,
            {"id": modifier_id, "source_owner_id": source_owner_id},
            wait_for_response=True,
            timeout=timeout,
        )
        self.list_modifiers(timeout=timeout)
        return self

    def clear_pipeline(
        self: "Molvis", *, timeout: float = 5.0
    ) -> "Molvis":
        """Remove every modifier from the pipeline."""
        self.send_cmd(
            FrontendCommands.PIPELINE_CLEAR.method,
            {},
            wait_for_response=True,
            timeout=timeout,
        )
        self._clear_mirror()
        return self
