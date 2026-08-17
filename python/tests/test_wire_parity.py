"""Drift gates for the three things both sides of the seam must agree on.

Each of these was a live divergence before the wire refactor:

* Python called 16 RPC methods the frontend had no handler for; 15 public
  ``Stage`` methods were dead, most of them **silently** because they did not
  wait for a response.
* ``core/src/keys.ts`` transcribes ``molrs.keys``, which nothing checked.
* The wire dtype tags are written out in both languages.

These tests read the TypeScript sources directly, so they run offline with no
browser and no build step.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from molrs import keys as molrs_keys

from molvis.commands.catalog import RPC_PROTOCOL_VERSION, rpc_method_names

REPO = Path(__file__).resolve().parents[2]
CATALOG_TS = REPO / "stage" / "src" / "transport" / "rpc" / "catalog.ts"
KEYS_TS = REPO / "core" / "src" / "keys.ts"
WIRE_TS = REPO / "stage" / "src" / "transport" / "rpc" / "wire.ts"

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

    def test_protocol_versions_match(self):
        ts_version = re.search(
            r'RPC_PROTOCOL_VERSION = "([^"]+)"', CATALOG_TS.read_text()
        )
        assert ts_version is not None
        assert RPC_PROTOCOL_VERSION == ts_version.group(1)


@requires_ts
class TestKeysParity:
    """``core/src/keys.ts`` mirrors ``molrs.keys``; nothing else may define it."""

    def test_scalar_keys_match_molrs(self):
        ts = _ts_consts(KEYS_TS.read_text())
        mismatches = {
            name: (value, getattr(molrs_keys, name))
            for name, value in ts.items()
            if hasattr(molrs_keys, name) and getattr(molrs_keys, name) != value
        }
        assert not mismatches, (
            f"core/src/keys.ts disagrees with molrs.keys: {mismatches}. "
            "molrs is the source of truth; fix the TypeScript mirror."
        )

    def test_endpoint_order_matches_molrs(self):
        endpoints = _ts_string_list(
            KEYS_TS.read_text(), "export const ENDPOINTS = [", "] as const"
        )
        assert endpoints == list(molrs_keys.ENDPOINTS)

    def test_coordinate_order_matches_molrs(self):
        coords = _ts_string_list(
            KEYS_TS.read_text(), "export const COORDS = [", "] as const"
        )
        assert coords == list(molrs_keys.COORDS)

    def test_every_mirrored_key_exists_in_molrs(self):
        ts = _ts_consts(KEYS_TS.read_text())
        # Block names are molvis's, not molrs's — see the note in keys.ts.
        block_names = {"ATOMS_BLOCK", "BONDS_BLOCK"}
        unknown = sorted(set(ts) - block_names - set(dir(molrs_keys)))
        assert not unknown, (
            f"core/src/keys.ts invents names molrs does not define: {unknown}"
        )


@requires_ts
class TestWireDtypeParity:
    def test_both_sides_agree_on_the_dtype_tags(self):
        from molvis.wire import _NUMPY_BY_DTYPE

        ts_source = WIRE_TS.read_text()
        declaration = re.search(
            r"export type WireDType =([^;]+);", ts_source, re.DOTALL
        )
        assert declaration is not None, "failed to find WireDType in wire.ts"
        ts_dtypes = set(re.findall(r'"([^"]+)"', declaration.group(1)))

        python_dtypes = set(_NUMPY_BY_DTYPE) | {"string"}
        assert ts_dtypes == python_dtypes

    def test_buffer_marker_matches(self):
        from molvis.wire import BUFFER_REF_MARKER

        ts_marker = re.search(
            r'BUFFER_REF_MARKER = "([^"]+)"', WIRE_TS.read_text()
        )
        assert ts_marker is not None
        assert BUFFER_REF_MARKER == ts_marker.group(1)
