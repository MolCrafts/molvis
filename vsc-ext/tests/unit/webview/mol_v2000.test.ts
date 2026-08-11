/**
 * Sketch Quick View MOL V2000 peek parser (no VS Code host).
 */

import * as assert from "assert";
import { tryParseMolV2000 } from "../../../src/webview/mol_v2000";

const WATER = `water
  MolVis

  3  2  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
    0.9600    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0
   -0.2400    0.9300    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
  1  3  1  0  0  0  0
M  END
`;

suite("tryParseMolV2000", () => {
  test("parses a tiny water MOL block", () => {
    const data = tryParseMolV2000(WATER);
    assert.ok(data);
    assert.strictEqual(data?.atoms.length, 3);
    assert.strictEqual(data?.bonds.length, 2);
    assert.strictEqual(data?.atoms[0]?.element, "O");
    assert.strictEqual(data?.bonds[0]?.i, 0);
    assert.strictEqual(data?.bonds[0]?.j, 1);
  });

  test("returns null for non-MOL text", () => {
    assert.strictEqual(tryParseMolV2000("not a molecule"), null);
  });
});
