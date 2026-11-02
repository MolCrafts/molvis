"""Selection commands for MolVis."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import TYPE_CHECKING

import molpy as mp
from molrs.io import read_msgpack_frame_bytes

from .catalog import FrontendCommands

if TYPE_CHECKING:
    from ..scene import Molvis

logger = logging.getLogger("molvis")

__all__ = ["SelectionCommandsMixin"]


class SelectionCommandsMixin:
    """Selection queries for :class:`~molvis.scene.Molvis`."""

    def get_selected(self: "Molvis", timeout: float = 5.0) -> mp.Frame:
        """Return the current selection as a :class:`molpy.Frame`.

        A real subset of the displayed frame: every column the atoms and bonds
        blocks carry comes along, with molrs column names, and bond endpoints
        renumbered into the returned atom subset so the frame stands alone.

        Args:
            timeout: Maximum seconds to wait for the frontend.

        Returns:
            A Frame with ``atoms`` / ``bonds`` blocks (empty when nothing is
            selected).

        Raises:
            TimeoutError: The frontend did not respond in time.
            molvis.MolvisRPCError: The frontend rejected the query.

        Example:
            >>> selected = stage.get_selected()
            >>> selected["atoms"].copy_column("element")
            array(['C', 'N', 'O'], dtype='<U1')
        """
        data = self.send_cmd(
            FrontendCommands.GET_SELECTED.method,
            {},
            wait_for_response=True,
            timeout=timeout,
        )
        if not isinstance(data, Mapping) or not isinstance(data.get("frame"), bytes):
            raise ValueError(f"Unexpected response from selection.get: {data!r}")
        return read_msgpack_frame_bytes(data["frame"])

    def select_atom_by_id(self: "Molvis", atom_ids: int | list[int]) -> "Molvis":
        """Select atoms by 0-based row index into the atoms block.

        Blocks until the frontend has applied the selection and written it
        into the active manual region. :attr:`~molvis.scene.Molvis.selection`
        matches that set when this returns.

        Raises:
            molvis.MolvisRPCError: The frontend rejected the selection.
            TimeoutError: The frontend did not respond in time.
        """
        ids = [atom_ids] if isinstance(atom_ids, int) else list(atom_ids)
        data = self.send_cmd(
            FrontendCommands.SELECT_ATOMS.method,
            {"ids": ids},
            wait_for_response=True,
        )
        if isinstance(data, Mapping) and "atom_ids" in data:
            reported = _selection_from_payload(data)
            # The frontend also pushes selection_changed before this reply.
            # Publish only when that event has not already filled the cache.
            if self.selection != reported:
                self.events.dispatch(
                    "event.selection_changed",
                    {
                        "atom_ids": data.get("atom_ids") or [],
                        "bond_ids": data.get("bond_ids") or [],
                    },
                )
        return self
