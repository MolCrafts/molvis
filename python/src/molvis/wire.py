"""Frame wire format — Python half of ``stage/src/transport/rpc/wire.ts``.

Nothing in this module invents a name or a layout.

**Names** come from :mod:`molpy.core.keys`. ``x``/``y``/``z``, ``element``,
``type``, ``charge``, ``atomi``/``atomj``/``atomk``/``atoml``, ``bond_type``/
``bond_number`` — this module reads that registry, it does not define one,
and it never renames a column.
Translating a format-native spelling (``species``, ``q``, ``mol``) to a
canonical one is the molrs readers' job at the I/O boundary.

**Storage dtypes** likewise come from the registry rather than from a value's
runtime type. That is the whole point: the browser used to guess a column's
dtype from what the JSON happened to look like, so whole-number coordinates
became ``u32`` and the atoms disappeared. Here the dtype of a canonical field is
decided once, by molrs, and stated explicitly on the wire.

The wire preserves native integer widths, float64, bool and string columns.
Each column carries its own shape, separate from a block's structural grid shape.
Unsupported complex/nullable columns and precision/target declarations raise
``WireError`` instead of losing information. Raw mappings adopt canonical field
dtypes with checked, lossless conversions; native Blocks retain storage dtypes.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any, Literal, cast

import molpy as mp
import numpy as np
from molpy.core import Block, MetaValue
from molpy.core import schema as _schema

__all__ = [
    "ATOMS_BLOCK",
    "BONDS_BLOCK",
    "BUFFER_REF_MARKER",
    "WireError",
    "canonical_dtype",
    "decode_box",
    "decode_frame",
    "encode_box",
    "encode_frame",
    "resolve_buffers",
]

WireDType = Literal[
    "f64", "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "bool", "string"
]

#: Marker key identifying a binary-buffer reference inside a JSON payload.
#: Matches ``BUFFER_REF_MARKER`` in ``stage/src/transport/rpc/wire.ts``.
BUFFER_REF_MARKER = "__molvis_buffer__"

#: Conventional block names. Unlike column names these are *not* in
#: ``molpy.core.keys`` — molrs names blocks at the ``Frame`` level and takes whatever
#: it is given. These two are the names every molpy reader emits and the
#: renderer looks for, so they live here rather than as scattered literals.
ATOMS_BLOCK = "atoms"
BONDS_BLOCK = "bonds"


class WireError(ValueError):
    """A value that cannot be put on the wire without guessing what it means."""


# ---------------------------------------------------------------------------
# Canonical dtype registry — derived from molrs, not written here
# ---------------------------------------------------------------------------


_NUMPY_BY_DTYPE = {
    "f64": np.float64,
    "i8": np.int8,
    "i16": np.int16,
    "i32": np.int32,
    "i64": np.int64,
    "u8": np.uint8,
    "u16": np.uint16,
    "u32": np.uint32,
    "u64": np.uint64,
    "bool": np.bool_,
}


def _wire_dtype_from_schema(kind: str) -> WireDType | None:
    """Map a molrs schema dtype name onto a wire carrier dtype."""
    if kind in _NUMPY_BY_DTYPE or kind == "string":
        return cast(WireDType, kind)
    return None


def _field_name(key: object) -> str:
    """Canonical column name as a plain ``str``.

    ``molpy.core.keys`` constants are ``Key`` objects: they compare equal to their
    string form (``Key("x") == "x"``) but do not hash as ``str``, so dict
    lookup and ``in`` must go through the name.
    """
    name = getattr(key, "key", None)
    if isinstance(name, str):
        return name
    return str(key)


def _canonical_registry() -> dict[str, WireDType]:
    """Map canonical field name → wire dtype from molrs — never hand-copied.

    :mod:`molpy.core.schema` is the Frame vocabulary the Validator uses.
    """
    registry: dict[str, WireDType] = {}
    for spec in _schema.columns:
        wire = _wire_dtype_from_schema(spec.dtype)
        if wire is not None:
            registry[_field_name(spec.key)] = wire
    return registry


_CANONICAL: dict[str, WireDType] = _canonical_registry()


def canonical_dtype(key: str) -> WireDType | None:
    """Wire dtype molrs defines for canonical field *key*, or ``None``.

    ``None`` means "not a canonical field" — such a column keeps whatever dtype
    its array already has, exactly like molrs, which lets an unregistered field
    take the dtype of its first write.

    *key* may be a ``str`` or a ``molpy.core.keys.Key``; lookup is by name.
    """
    return _CANONICAL.get(_field_name(key))


# ---------------------------------------------------------------------------
# Column encoding
# ---------------------------------------------------------------------------

_I64_MIN, _I64_MAX = -(2**63), 2**63 - 1
_U64_MAX = 2**64 - 1


def _observed_dtype(array: np.ndarray, key: str) -> WireDType:
    """Wire dtype for a column molrs has no canonical dtype for."""
    if array.dtype.kind == "U" or (
        array.dtype.kind == "O" and all(isinstance(v, str) for v in array.flat)
    ):
        return "string"
    for dtype, numpy_type in _NUMPY_BY_DTYPE.items():
        if array.dtype == np.dtype(numpy_type):
            return cast(WireDType, dtype)
    raise WireError(f"column {key!r} has unsupported numpy dtype {array.dtype!r}")


def _cast(
    array: np.ndarray, dtype: WireDType, key: str
) -> np.ndarray | list[str] | list[bool]:
    """Convert canonical mappings only when every source value is representable."""
    flat = array.reshape(-1)
    if dtype == "string":
        if not all(isinstance(value, str) for value in flat):
            raise WireError(f"column {key!r}: string columns require strings")
        return flat.tolist()
    if flat.dtype.kind not in "biuf":
        raise WireError(
            f"column {key!r}: cannot convert {flat.dtype} to {dtype} without loss"
        )
    target = np.dtype(_NUMPY_BY_DTYPE[dtype])
    if target.kind in "iu":
        limits = np.iinfo(target)
        if flat.dtype.kind == "f" and (
            not np.all(np.isfinite(flat)) or not np.all(flat == np.trunc(flat))
        ):
            raise WireError(
                f"column {key!r}: fractional or non-finite values cannot be {dtype}"
            )
        if flat.size and (int(flat.min()) < limits.min or int(flat.max()) > limits.max):
            raise WireError(f"column {key!r} must be {dtype}; values are out of range")
    elif target.kind == "b" and flat.dtype.kind != "b":
        raise WireError(f"column {key!r}: bool columns require booleans")
    converted = flat.astype(target, copy=False)
    if target.kind == "f":
        if flat.dtype.kind in "iu":
            if any(
                int(before) != int(after)
                for before, after in zip(flat, converted, strict=True)
            ):
                raise WireError(
                    f"column {key!r}: conversion to {dtype} loses integer precision"
                )
        elif flat.dtype.kind == "f" and not np.array_equal(
            flat, converted.astype(flat.dtype), equal_nan=True
        ):
            raise WireError(f"column {key!r}: conversion to {dtype} loses precision")
    if dtype == "bool":
        return converted.tolist()
    return np.ascontiguousarray(converted)


def _encode_column(
    key: str, values: Any, *, canonical: bool = True
) -> tuple[WireDType, np.ndarray | list[str] | list[bool]]:
    """One block column → ``(dtype, carrier)``.

    Raw mappings adopt molrs's canonical dtype when declared for *key*;
    native Blocks retain their own dtype. Neither infers dtype from values.
    """
    if np.ma.isMaskedArray(values) and np.ma.getmaskarray(values).any():
        raise WireError(
            f"column {key!r}: nullable values cannot be reconstructed by the wire"
        )
    array = np.asarray(values)
    if array.ndim == 0:
        array = array.reshape(1)
    dtype = (canonical_dtype(key) if canonical else None) or _observed_dtype(array, key)
    return dtype, _cast(array, dtype, key)


# ---------------------------------------------------------------------------
# Frame / Box encoding
# ---------------------------------------------------------------------------


def _frame_mapping(frame: Any) -> dict[str, Any]:
    if isinstance(frame, Mapping):
        return dict(frame)
    if isinstance(frame, mp.Frame):
        return {
            # Native Frame exposes keys(), but has no iterator protocol.
            "blocks": {name: frame[name] for name in frame.keys()},  # noqa: SIM118
            "meta": frame.meta,
            "box": frame.box,
        }
    raise WireError(f"expected a Frame or a mapping with 'blocks'; got {type(frame)!r}")


def _validate_frame(frame: Any) -> None:
    """Run molrs schema validation. Never re-check endpoints/dtypes here.

    A :class:`molpy.Frame` exposes ``validate()``, which
    delegates to ``Validator::canonical``. Raw wire mappings are left alone — building them
    into a Frame would re-implement insert-time rules in this module, and the
    browser side runs the same validator after ``decodeFrame``.
    """
    validate = getattr(frame, "validate", None)
    if not callable(validate):
        return
    try:
        validate()
    except Exception as exc:
        raise WireError(str(exc)) from exc


def encode_frame(
    frame: Any, *, inline: bool = False
) -> tuple[dict[str, Any], list[Any]]:
    """Serialize a Frame for the wire.

    Args:
        frame: A :class:`molpy.Frame`, or a mapping shaped like one
            (``{"blocks": {...}, "metadata": {...}}``).
        inline: When ``True``, numeric columns are left as ndarrays in the
            payload for a transport that can carry them directly (the in-process
            Pyodide bridge). When ``False`` (the WebSocket default) they become
            buffer references into the returned buffer list.

    Returns:
        ``(payload, buffers)``. ``payload`` matches ``WireFrame`` in
        ``core/src/wire.ts``; ``buffers`` is empty when *inline* is ``True*.
    """
    raw = _frame_mapping(frame)
    raw_blocks = raw.get("blocks") or {}
    if not isinstance(raw_blocks, Mapping):
        raise WireError("frame 'blocks' must be a mapping of name → columns")

    # Schema judgment is molrs's job — do not reimplement endpoint/dtype rules.
    _validate_frame(frame if not isinstance(frame, Mapping) else raw)

    buffers: list[Any] = []

    def carrier(value: np.ndarray | list[str] | list[bool], dtype: WireDType) -> Any:
        if dtype in ("string", "bool") or inline:
            return value
        buffers.append(memoryview(value))  # type: ignore[arg-type]
        return {BUFFER_REF_MARKER: True, "index": len(buffers) - 1}

    blocks: dict[str, Any] = {}
    for raw_name, raw_columns in raw_blocks.items():
        block_name = str(raw_name)
        columns_source = _block_columns(block_name, raw_columns)

        columns: dict[str, Any] = {}
        structural = getattr(raw_columns, "structural_shape", None)
        shape: list[int] | None = (
            [int(n) for n in structural] if structural is not None else None
        )
        for raw_key, raw_value in columns_source.items():
            key = str(raw_key)
            path = f"{block_name}.{key}"
            if isinstance(raw_columns, Block) and (
                raw_columns.validity(key) is not None
                or raw_columns.precision(key) is not None
                or raw_columns.target(key) is not None
            ):
                raise WireError(
                    f"{path}: nullable columns and precision/target declarations cannot be reconstructed by the wire"
                )
            array = np.asarray(raw_value)
            dtype, data = _encode_column(
                key, raw_value, canonical=not isinstance(raw_columns, Block)
            )
            if dtype == "bool" and array.size == 0:
                raise WireError(
                    f"{path}: browser cannot reconstruct an empty bool column"
                )
            columns[key] = {
                "dtype": dtype,
                "data": carrier(data, dtype),
                "shape": list(array.shape) or [1],
            }

        block: dict[str, Any] = {"columns": columns}
        if shape is not None:
            block["shape"] = shape
        blocks[block_name] = block

    payload: dict[str, Any] = {"blocks": blocks}

    box = raw.get("box") if isinstance(raw, Mapping) else None
    if box is None:
        box = getattr(frame, "box", None)
    if box is not None:
        payload["box"] = encode_box(box, carrier=carrier)

    meta = _scalar_meta(
        raw.get("meta") if raw.get("meta") is not None else raw.get("metadata")
    )
    if meta:
        payload["meta"] = meta

    return payload, buffers


def _block_columns(block_name: str, raw_columns: Any) -> Mapping[str, Any]:
    """Accept a mapping of columns, or a ``molpy.core.Block``."""
    if isinstance(raw_columns, Mapping):
        return raw_columns
    if isinstance(raw_columns, Block):
        return {key: raw_columns[key] for key in raw_columns}
    raise WireError(f"block {block_name!r} must be a mapping of column → array")


def _scalar_meta(metadata: Any) -> dict[str, Any]:
    """Keep the numeric metadata molrs can store per frame (``setMeta``).

    Accepts both the wire/dict key ``metadata`` and a molrs ``Frame.meta`` map
    (values may be bare numbers or ``molpy.core.MetaValue``).

    Integers use a dtype tag and decimal text so JSON never rounds i64/u64.
    Non-numeric metadata is outside this scalar RPC contract.
    """
    if not isinstance(metadata, Mapping):
        return {}
    out: dict[str, Any] = {}
    for key, value in metadata.items():
        # molpy.core.MetaValue carries .value / .dtype
        if hasattr(value, "value") and hasattr(value, "dtype"):
            value = getattr(value, "value", value)
            # Nested F64(...) wrappers expose .value again in some builds.
            if hasattr(value, "value"):
                value = value.value
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, np.integer)):
            number = int(value)
            if not _I64_MIN <= number <= _U64_MAX:
                raise WireError(f"meta.{key}: integer is outside the i64/u64 range")
            out[str(key)] = {
                "dtype": "u64" if number > _I64_MAX else "i64",
                "data": str(number),
            }
        elif isinstance(value, (float, np.floating)):
            number = float(value)
            if np.isfinite(number):
                out[str(key)] = number
    return out


def encode_box(box: Any, *, carrier: Any = None) -> dict[str, Any]:
    """Serialize a :class:`molpy.Box`.

    ``h`` is ``Box.matrix`` flattened row-major — the matrix whose *columns* are
    the lattice vectors, which is what molrs ``new Box(h, …)`` consumes. The
    array is already C-contiguous, so this is a reshape, not a transpose.
    """
    matrix = np.ascontiguousarray(np.asarray(box.matrix, dtype=np.float64)).reshape(-1)
    if matrix.size != 9:
        raise WireError(f"box matrix must hold 9 values, got {matrix.size}")
    origin = np.ascontiguousarray(np.asarray(box.origin, dtype=np.float64)).reshape(-1)
    if origin.size != 3:
        raise WireError(f"box origin must hold 3 values, got {origin.size}")
    pbc = [bool(flag) for flag in np.asarray(box.pbc).reshape(-1)]
    if len(pbc) != 3:
        raise WireError(f"box pbc must hold 3 flags, got {len(pbc)}")

    if carrier is None:
        return {"h": matrix, "origin": origin, "pbc": pbc}
    return {
        "h": carrier(matrix, "f64"),
        "origin": carrier(origin, "f64"),
        "pbc": pbc,
    }


# ---------------------------------------------------------------------------
# Decoding — wire → molpy
# ---------------------------------------------------------------------------


def _decode_column(path: str, column: Any, buffers: Sequence[Any]) -> np.ndarray:
    if not isinstance(column, Mapping):
        raise WireError(f"{path}: column must be an object with 'dtype' and 'data'")
    dtype = column.get("dtype")
    data = column.get("data")

    if dtype in ("string", "bool"):
        expected = str if dtype == "string" else bool
        if (
            not isinstance(data, Sequence)
            or isinstance(data, (str, bytes))
            or not all(isinstance(v, expected) for v in data)
        ):
            raise WireError(
                f'{path}: dtype "{dtype}" requires a list of {expected.__name__} values'
            )
        return np.asarray(data, dtype=np.str_ if dtype == "string" else np.bool_)

    numpy_dtype = _NUMPY_BY_DTYPE.get(dtype) if isinstance(dtype, str) else None
    if numpy_dtype is None:
        raise WireError(f"{path}: unknown dtype {dtype!r}")

    if isinstance(data, Mapping) and data.get(BUFFER_REF_MARKER) is True:
        index = data.get("index")
        if (
            isinstance(index, bool)
            or not isinstance(index, int)
            or not 0 <= index < len(buffers)
        ):
            raise WireError(f"{path}: buffer index {index!r} is out of range")
        try:
            return np.frombuffer(buffers[index], dtype=numpy_dtype)
        except (ValueError, TypeError) as exc:
            raise WireError(f"{path}: invalid {dtype} buffer: {exc}") from exc
    if isinstance(data, np.ndarray) and data.dtype != np.dtype(numpy_dtype):
        raise WireError(f"{path}: carrier dtype {data.dtype} disagrees with {dtype}")
    # Legacy JSON scalar columns may contain ordinary lists; checked conversion
    # preserves their values instead of letting numpy truncate or wrap them.
    return np.asarray(_cast(np.asarray(data), cast(WireDType, dtype), path))


def resolve_buffers(payload: Any, buffers: Sequence[Any]) -> Any:
    """Replace every buffer reference in *payload* with its ndarray.

    Applied to an inbound message once, at the transport, so the rest of the
    Python side sees columns whose ``data`` is already an array. Resolution is
    driven by each column's own ``dtype`` tag — the bytes are never interpreted
    by guessing at their content.
    """
    if isinstance(payload, Mapping):
        dtype = payload.get("dtype")
        data = payload.get("data")
        if (
            isinstance(dtype, str)
            and dtype in _NUMPY_BY_DTYPE
            and isinstance(data, Mapping)
            and data.get(BUFFER_REF_MARKER) is True
        ):
            return {**payload, "data": _decode_column("buffer", payload, buffers)}
        return {key: resolve_buffers(value, buffers) for key, value in payload.items()}
    if isinstance(payload, list):
        return [resolve_buffers(item, buffers) for item in payload]
    return payload


def decode_frame(payload: Any, buffers: Sequence[Any] = ()) -> mp.Frame:
    """Rebuild a :class:`molpy.Frame` from a wire payload.

    The inverse of :func:`encode_frame`: every block and every column comes
    back, with the dtype the payload declared. Shapes unsupported by molpy
    (currently multidimensional strings) raise WireError.
    """
    if not isinstance(payload, Mapping):
        raise WireError("frame payload must be an object")
    raw_blocks = payload.get("blocks")
    if not isinstance(raw_blocks, Mapping):
        raise WireError("frame payload must include a 'blocks' object")

    blocks: dict[str, Any] = {}
    for raw_name, raw_block in raw_blocks.items():
        block_name = str(raw_name)
        if not isinstance(raw_block, Mapping):
            raise WireError(f"{block_name}: block must be an object")
        raw_columns = raw_block.get("columns")
        if not isinstance(raw_columns, Mapping):
            raise WireError(f"{block_name}: block must include a 'columns' object")
        columns: dict[str, np.ndarray] = {}
        for raw_key, raw_column in raw_columns.items():
            key = str(raw_key)
            path = f"{block_name}.{key}"
            array = _decode_column(path, raw_column, buffers)
            shape = raw_column.get("shape")
            if shape is not None:
                if (
                    not isinstance(shape, list)
                    or not shape
                    or any(
                        isinstance(n, bool) or not isinstance(n, int) or n < 0
                        for n in shape
                    )
                ):
                    raise WireError(
                        f"{path}: shape must be a non-empty array of non-negative integers"
                    )
                try:
                    array = array.reshape(shape)
                except ValueError as exc:
                    raise WireError(f"{path}: invalid column shape: {exc}") from exc
            columns[key] = array
        block = Block()
        for key, array in columns.items():
            try:
                block.insert(key, array)
            except (ValueError, TypeError) as exc:
                raise WireError(f"{block_name}.{key}: {exc}") from exc
            if block[key].dtype != array.dtype:
                raise WireError(
                    f"{block_name}.{key}: native setter changed dtype {array.dtype} to {block[key].dtype}"
                )
        shape = raw_block.get("shape")
        if shape is not None:
            if not isinstance(shape, list) or any(
                isinstance(n, bool) or not isinstance(n, int) or n < 0 for n in shape
            ):
                raise WireError(f"{block_name}: invalid structural shape")
            try:
                block.set_shape(shape)
            except (ValueError, TypeError) as exc:
                raise WireError(f"{block_name}: {exc}") from exc
        blocks[block_name] = block

    frame = mp.Frame(blocks=blocks)

    meta = payload.get("meta")
    if meta is not None and not isinstance(meta, Mapping):
        raise WireError("frame 'meta' must be an object")
    if isinstance(meta, Mapping) and meta:
        decoded_meta = {}
        for key, value in meta.items():
            if isinstance(value, Mapping):
                dtype, data = value.get("dtype"), value.get("data")
                if (
                    dtype not in ("i64", "u64")
                    or not isinstance(data, str)
                    or re.fullmatch(r"-?(0|[1-9][0-9]*)", data) is None
                ):
                    raise WireError(f"meta.{key}: expected i64/u64 decimal data")
                number = int(data)
                low, high = (_I64_MIN, _I64_MAX) if dtype == "i64" else (0, _U64_MAX)
                if not low <= number <= high:
                    raise WireError(f"meta.{key}: {dtype} value is out of range")
                decoded_meta[str(key)] = MetaValue(dtype, number)
            elif (
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and np.isfinite(value)
            ):
                decoded_meta[str(key)] = MetaValue("f64", float(value))
            else:
                raise WireError(
                    f"meta.{key}: expected a finite number or tagged integer"
                )
        frame.meta = decoded_meta

    box = payload.get("box")
    if box is not None:
        frame.box = decode_box(box, buffers)

    _validate_frame(frame)
    return frame


def decode_box(payload: Any, buffers: Sequence[Any] = ()) -> mp.Box:
    """Rebuild a :class:`molpy.Box`. ``h`` is read row-major (see :func:`encode_box`)."""
    if not isinstance(payload, Mapping):
        raise WireError("box payload must be an object")
    h = _decode_column("box.h", {"dtype": "f64", "data": payload.get("h")}, buffers)
    origin = _decode_column(
        "box.origin", {"dtype": "f64", "data": payload.get("origin")}, buffers
    )
    if h.size != 9:
        raise WireError(f"box.h must hold 9 values, got {h.size}")
    if origin.size != 3:
        raise WireError(f"box.origin must hold 3 values, got {origin.size}")
    pbc = payload.get("pbc")
    if not isinstance(pbc, Sequence) or len(pbc) != 3:
        raise WireError("box.pbc must be three booleans")
    # The native Cell matrix has lattice vectors as columns, so the
    # row-major wire array reshapes straight into it.
    return mp.Box(
        mp.core.Cell.matrix(h.reshape(3, 3)),
        origin,
        np.asarray([bool(flag) for flag in pbc]),
    )
