"""Structure coercion for the frame / molgraph API surface.

Convention
----------
Commands that take molecular data put the structure as the **first** argument
after ``self``::

    stage.draw_frame(frame)        # Frame | Atomistic | molgraph
    stage.commit()                 # edit pool → pipeline HEAD
    stage.set_trajectory(frames, …)

:func:`frame_arg` and :func:`frames_arg` coerce that argument to a Frame-like.
Serialization is :mod:`molvis.wire`, which states each column's dtype from the
molrs field registry instead of leaving the browser to guess.
"""

from __future__ import annotations

import functools
import inspect
import logging
from collections.abc import Callable
from typing import Any, TypeVar

from molrs.core import Frame
from molrs.perceive import assign_kekule_bond_orders

logger = logging.getLogger("molvis")

__all__ = [
    "coerce_to_frame",
    "frame_arg",
    "frame_payload",
    "frames_arg",
]

R = TypeVar("R")


def _with_kekule_orders(obj: Any) -> Any:
    """Fill localized ``bond_number`` on aromatic bonds via molrs perception.

    Graph-in / graph-out; never mutates *obj*. This is
    ``molrs.perceive.assign_kekule_bond_orders`` — the same chemistry as the
    WASM face used by the page. A graph it cannot read is logged and returned
    unchanged, so perception cannot break a draw.
    """
    try:
        return assign_kekule_bond_orders(obj)
    except (TypeError, ValueError) as exc:
        logger.debug(
            "assign_kekule_bond_orders skipped for %r: %s", type(obj).__name__, exc
        )
        return obj


def coerce_to_frame(
    obj: Any,
    *,
    atom_fields: list[str] | None = None,
) -> Any:
    """Normalize Frame | Atomistic | molgraph | mapping → Frame or frame mapping.

    Order of checks
    ---------------
    1. :class:`molrs.core.Frame` → passed through.
    2. Mapping with ``blocks`` → passed through.
    3. Graph / Atomistic with ``to_frame`` → Kekulé fill (when possible) then
       ``to_frame(atom_fields=…)``.
    """
    if obj is None:
        raise TypeError("structure argument is required (got None)")

    if isinstance(obj, Frame):
        return obj

    if isinstance(obj, dict) and "blocks" in obj:
        return obj

    if callable(getattr(obj, "to_frame", None)):
        obj = _with_kekule_orders(obj)
        if atom_fields is not None:
            return obj.to_frame(atom_fields=atom_fields)
        return obj.to_frame()

    raise TypeError(
        "expected a Frame, Atomistic/molgraph (to_frame), or frame mapping "
        f"with 'blocks'; got {type(obj)!r}"
    )


def frame_payload(
    obj: Any,
    *,
    atom_fields: list[str] | None = None,
    inline: bool = False,
) -> tuple[dict[str, Any], list[Any]]:
    """Coerce a structure and serialize it → ``(wire frame, buffers)``."""
    from .wire import encode_frame

    return encode_frame(
        coerce_to_frame(obj, atom_fields=atom_fields),
        inline=inline,
    )


def _first_data_param(sig: inspect.Signature) -> str:
    params = [
        p
        for p in sig.parameters.values()
        if p.name != "self"
        and p.kind
        in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        )
    ]
    if not params:
        raise TypeError("method must have a first data parameter after self")
    return params[0].name


def frame_arg(fn: Callable[..., R]) -> Callable[..., R]:
    """Decorator: first data arg is Frame | molgraph | Atomistic.

    Supports positional and keyword calls (``draw_frame(f)`` /
    ``draw_frame(frame=f)``).
    """

    sig = inspect.signature(fn)
    data_name = _first_data_param(sig)

    @functools.wraps(fn)
    def wrapper(self: Any, *args: Any, **kwargs: Any) -> R:
        bound = sig.bind(self, *args, **kwargs)
        bound.apply_defaults()
        atom_fields = bound.arguments.get("atom_fields")
        fields = atom_fields if isinstance(atom_fields, list) else None
        bound.arguments[data_name] = coerce_to_frame(
            bound.arguments[data_name], atom_fields=fields
        )
        return fn(*bound.args, **bound.kwargs)

    wrapper.__signature__ = sig  # type: ignore[attr-defined]
    return wrapper  # type: ignore[return-value]


def frames_arg(fn: Callable[..., R]) -> Callable[..., R]:
    """Decorator: first data arg is an iterable of structures → list[Frame]."""

    sig = inspect.signature(fn)
    data_name = _first_data_param(sig)

    @functools.wraps(fn)
    def wrapper(self: Any, *args: Any, **kwargs: Any) -> R:
        bound = sig.bind(self, *args, **kwargs)
        bound.apply_defaults()
        frames = bound.arguments[data_name]
        if frames is None:
            raise TypeError("frames argument is required (got None)")
        seq = list(frames)
        if not seq:
            raise ValueError("expected a non-empty sequence of frames/structures")
        bound.arguments[data_name] = [coerce_to_frame(item) for item in seq]
        return fn(*bound.args, **bound.kwargs)

    wrapper.__signature__ = sig  # type: ignore[attr-defined]
    return wrapper  # type: ignore[return-value]
