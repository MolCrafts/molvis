jest.mock("@babylonjs/core", () => {
  return {
    Vector3: class {
      constructor(
        public x: number,
        public y: number,
        public z: number,
      ) {}
    },
  };
});
import { Vector3 } from "@babylonjs/core";
import { Atom } from "../src/system/item";

describe("Atom", () => {
  it("test_init_atom", () => {
    const atom = new Atom("H", 0, 0, 0, { charge: 1 });
    expect(atom.name).toBe("H");
    expect(atom.get("charge")).toBe(1);
    expect(atom.xyz).toEqual(new Vector3(0, 0, 0));
  });
});
