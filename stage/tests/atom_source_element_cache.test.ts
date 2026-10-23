import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import { AtomSource } from "../src/entity_source";

function frameWithElements(elements: string[]): Frame {
  const f = new Frame();
  const b = new Block();
  const n = elements.length;
  b.set(
    "x",
    new Float64Array(n).map((_, i) => i),
  );
  b.set("y", new Float64Array(n));
  b.set("z", new Float64Array(n));
  b.set("element", elements);
  f.set("atoms", b);
  return f;
}

describe("AtomSource element cache", () => {
  it("returns correct elements (cache hit on repeated getMeta)", () => {
    const src = new AtomSource();
    src.setFrame(frameWithElements(["C", "H", "O"]));
    expect(src.getMeta(0)?.element).toBe("C");
    expect(src.getMeta(1)?.element).toBe("H");
    expect(src.getMeta(2)?.element).toBe("O");
    // Repeated reads (cache hits) stay correct.
    expect(src.getMeta(2)?.element).toBe("O");
    expect(src.getMeta(0)?.element).toBe("C");
  });

  it("invalidates the cache when the frame changes", () => {
    const src = new AtomSource();
    src.setFrame(frameWithElements(["C", "C"]));
    expect(src.getMeta(0)?.element).toBe("C");
    // New frame with different elements must not return stale cached values.
    src.setFrame(frameWithElements(["N", "O"]));
    expect(src.getMeta(0)?.element).toBe("N");
    expect(src.getMeta(1)?.element).toBe("O");
  });

  it("getAttribute('element') uses the same cached column", () => {
    const src = new AtomSource();
    src.setFrame(frameWithElements(["Fe", "Zn"]));
    expect(src.getAttribute(0, "element")).toBe("Fe");
    expect(src.getAttribute(1, "element")).toBe("Zn");
  });

  it("getAttribute reads i64 formal_charge and u64 res_id", () => {
    const frame = frameWithElements(["C"]);
    const atoms = frame.get("atoms");
    atoms.set("formal_charge", new BigInt64Array([-2n]));
    atoms.set("res_id", new BigUint64Array([7n]));
    const src = new AtomSource();
    src.setFrame(frame);
    expect(src.getAttribute(0, "formal_charge")).toBe(-2n);
    expect(src.getAttribute(0, "res_id")).toBe(7n);
  });
});
