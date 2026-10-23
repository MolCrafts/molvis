"""Drift gates for the things both sides of the RPC seam must agree on.

* Python called 16 RPC methods the frontend had no handler for; 15 public
  ``Stage`` methods were dead, most of them **silently** because they did not
  wait for a response.
* ``core/src/keys.ts`` transcribes ``molrs.keys``, which nothing checked.
* The binary-buffer reference marker is spelled in both languages.

Frame *contents* need no gate: both ends read and write them with molrs itself
(``molrs.io.write_msgpack_frame_bytes`` / molrs-wasm ``readMsgpackFrameBytes``).

These tests read the TypeScript sources directly, so they run offline with no
browser and no build step.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest
from molrs import keys as molrs_keys
from molrs import schema as molrs_schema

from molvis.commands.catalog import rpc_method_names

REPO = Path(__file__).resolve().parents[2]
CATALOG_TS = REPO / "stage" / "src" / "transport" / "rpc" / "catalog.ts"
KEYS_TS = REPO / "core" / "src" / "keys.ts"
RPC_TYPES_TS = REPO / "stage" / "src" / "transport" / "rpc" / "types.ts"

requires_ts = pytest.mark.skipif(
    not CATALOG_TS.exists(), reason="TypeScript sources not present in this checkout"
)


def _ts_string_list(source: str, start: str, end: str) -> list[str]:
    """Read a TS array literal, resolving bare identifiers via the consts map.

    ``COORDS = [X, Y, Z]`` names constants rather than repeating the strings,
    so the values have to be looked up.
    """
    body = source.split(start, 1)[1].split(end, 1)[0]
    consts = _ts_consts(source)
    items: list[str] = []
    for token in re.findall(r'"([^"]+)"|([A-Z_][A-Z0-9_]*)', body):
        literal, name = token
        if literal:
            items.append(literal)
        elif name in consts:
            items.append(consts[name])
    return items


def _ts_const_names(source: str) -> set[str]:
    """Every ``export const NAME`` in the module, whatever its value.

    Unlike :func:`_ts_consts` this also sees the list-valued groups
    (``COORDS``, ``ENDPOINTS``, ``DIPOLE``, ``QUAT``, ``VELOCITIES``), which
    have no string literal to match.
    """
    return set(re.findall(r"export const ([A-Z_][A-Z0-9_]*)\s*=", source))


def _ts_consts(source: str) -> dict[str, str]:
    return dict(re.findall(r'export const (\w+) = "([^"]+)";', source))


@requires_ts
class TestRpcCatalogParity:
    def test_python_calls_only_methods_the_frontend_implements(self):
        """Every method Python can send must have a handler on the other side.

        This is the gate that would have caught ``overlay.add``,
        ``view.set_background``, ``capture.snapshot``, ``frame.seek`` and the
        rest — all of which Python sent to a frontend that answered
        ``-32601 Method not found``, most of them without waiting for the reply.
        """
        implemented = set(
            _ts_string_list(CATALOG_TS.read_text(), "RPC_METHODS = [", "] as const")
        )
        assert implemented, "failed to parse RPC_METHODS out of catalog.ts"

        dead = sorted(set(rpc_method_names()) - implemented)
        assert not dead, (
            "Python declares RPC methods the frontend has no handler for: "
            f"{dead}. Add a handler in stage/src/transport/rpc/router.ts (and "
            "list it in catalog.ts), or drop the Python surface."
        )

    def test_no_module_sends_a_method_name_the_catalog_does_not_declare(self):
        """Bare ``send_cmd("some.method")`` literals count too.

        ``camera.*`` and ``state.get`` were reached this way, and so were
        ``frame.seek``, ``capture.snapshot`` and ``palette.list`` — which is why
        the catalog-only view of the surface looked healthier than it was.
        """
        implemented = set(
            _ts_string_list(CATALOG_TS.read_text(), "RPC_METHODS = [", "] as const")
        )
        source_root = Path(__file__).resolve().parents[1] / "src" / "molvis"
        literals: dict[str, str] = {}
        for path in source_root.rglob("*.py"):
            for match in re.finditer(
                r'send_cmd\(\s*\n?\s*"([a-z_]+\.[a-z_]+)"', path.read_text()
            ):
                literals[match.group(1)] = path.name

        dead = sorted(
            f"{method} ({literals[method]})"
            for method in literals
            if method not in implemented
        )
        assert not dead, (
            f"Python sends RPC methods the frontend has no handler for: {dead}"
        )


# Aliases of molrs.schema block constants. They hold no string of their own.
_BLOCK_ALIASES = {"ATOMS_BLOCK": "ATOMS", "BONDS_BLOCK": "BONDS"}


def _schema_name_consts() -> set[str]:
    """Block-name constants on ``molrs.schema`` (strings and groups, not the int version)."""
    names = set()
    for name in dir(molrs_schema):
        if not name.isupper():
            continue
        value = getattr(molrs_schema, name)
        if isinstance(value, (str, tuple)):
            names.add(name)
    return names


@requires_ts
class TestKeysParity:
    """``core/src/keys.ts`` is generated from molrs. Regenerate it; do not edit it."""

    def test_generated_file_matches_the_wasm_projection(self):
        script = REPO / "core" / "scripts" / "gen-keys.mjs"
        result = subprocess.run(
            [
                "node",
                "--experimental-wasm-modules",
                str(script),
                "--check",
            ],
            cwd=REPO,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, (
            "core/src/keys.ts or the schema column table drifted from molrs.\n"
            + result.stdout
            + result.stderr
            + "\nRegenerate with: node --experimental-wasm-modules core/scripts/gen-keys.mjs"
        )

    def test_scalar_keys_match_molrs(self):
        ts = _ts_consts(KEYS_TS.read_text())
        mismatches = {
            name: (value, getattr(molrs_keys, name))
            for name, value in ts.items()
            if hasattr(molrs_keys, name) and getattr(molrs_keys, name) != value
        }
        assert not mismatches, (
            f"core/src/keys.ts disagrees with molrs.keys: {mismatches}. "
            "molrs is the source of truth; regenerate the TypeScript mirror."
        )

    def test_groups_match_molrs(self):
        source = KEYS_TS.read_text()
        for name in dir(molrs_keys):
            if not name.isupper():
                continue
            value = getattr(molrs_keys, name)
            if not isinstance(value, (list, tuple)):
                continue
            got = _ts_string_list(source, f"export const {name} = [", "] as const")
            assert got == [str(item) for item in value], name

    def test_block_names_match_molrs_schema(self):
        source = KEYS_TS.read_text()
        ts = _ts_consts(source)
        for name in _schema_name_consts():
            value = getattr(molrs_schema, name)
            if isinstance(value, str):
                assert ts[name] == value, name
            else:
                got = _ts_string_list(source, f"export const {name} = [", "] as const")
                assert got == [str(item) for item in value], name
        for alias, target in _BLOCK_ALIASES.items():
            assert re.search(rf"export const {alias} = {target};", source), alias
            assert ts[target] == getattr(molrs_schema, target)

    def test_every_mirrored_key_exists_in_molrs(self):
        ts = _ts_const_names(KEYS_TS.read_text())
        known = set(dir(molrs_keys)) | _schema_name_consts() | set(_BLOCK_ALIASES)
        unknown = sorted(ts - known)
        assert not unknown, (
            f"core/src/keys.ts invents names molrs does not define: {unknown}"
        )

    def test_every_molrs_key_is_mirrored(self):
        """A mirror that is a subset is a mirror that drifts."""
        ts = _ts_const_names(KEYS_TS.read_text())
        molrs_names = {n for n in dir(molrs_keys) if n.isupper()}
        missing = sorted(molrs_names - ts)
        assert not missing, (
            f"core/src/keys.ts is missing molrs.keys names: {missing}. "
            "molrs is the source of truth; regenerate the TypeScript mirror."
        )
        missing_blocks = sorted(_schema_name_consts() - ts)
        assert not missing_blocks, (
            f"core/src/keys.ts is missing molrs.schema names: {missing_blocks}."
        )


@requires_ts
class TestBufferRefParity:
    def test_buffer_marker_matches(self):
        from molvis.types import BUFFER_REF_MARKER

        ts_marker = re.search(
            r'BUFFER_REF_MARKER = "([^"]+)"', RPC_TYPES_TS.read_text()
        )
        assert ts_marker is not None
        assert BUFFER_REF_MARKER == ts_marker.group(1)

    def test_frame_format_matches(self):
        from molvis.types import FRAME_FORMAT

        ts_format = re.search(r'FRAME_FORMAT = "([^"]+)"', RPC_TYPES_TS.read_text())
        assert ts_format is not None
        assert FRAME_FORMAT == ts_format.group(1)
