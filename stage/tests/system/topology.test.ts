import { describe, expect, it } from "@rstest/core";
import { Topology } from "../../src/system/topology";

describe("Topology", () => {
  describe("addAtom / vcount", () => {
    it("should add atoms and track count", () => {
      const topo = new Topology();
      topo.addAtom(0);
      topo.addAtom(1);
      topo.addAtom(2);
      expect(topo.vcount()).toBe(3);
    });

    it("should not duplicate atoms with same id", () => {
      const topo = new Topology();
      topo.addAtom(5);
      topo.addAtom(5);
      expect(topo.vcount()).toBe(1);
    });
  });

  describe("addBond / ecount", () => {
    it("should add bonds and track count", () => {
      const topo = new Topology();
      topo.addBond(0, 0, 1);
      topo.addBond(1, 1, 2);
      expect(topo.ecount()).toBe(2);
    });

    it("should auto-create atoms when adding bonds", () => {
      const topo = new Topology();
      topo.addBond(0, 10, 20);
      expect(topo.vcount()).toBe(2);
    });
  });

  describe("neighbors", () => {
    it("should return neighbors of a vertex", () => {
      const topo = new Topology();
      topo.addBond(0, 0, 1);
      topo.addBond(1, 0, 2);
      topo.addBond(2, 1, 2);

      const n0 = topo.neighbors(0).sort();
      expect(n0).toEqual([1, 2]);

      const n1 = topo.neighbors(1).sort();
      expect(n1).toEqual([0, 2]);
    });

    it("should return empty array for isolated atom", () => {
      const topo = new Topology();
      topo.addAtom(0);
      expect(topo.neighbors(0)).toEqual([]);
    });

    it("should return empty array for non-existent atom", () => {
      const topo = new Topology();
      expect(topo.neighbors(999)).toEqual([]);
    });
  });

  describe("degree", () => {
    it("should return correct degree", () => {
      const topo = new Topology();
      topo.addBond(0, 0, 1);
      topo.addBond(1, 0, 2);
      topo.addBond(2, 0, 3);
      expect(topo.degree(0)).toBe(3);
      expect(topo.degree(1)).toBe(1);
    });

    it("should return 0 for non-existent atom", () => {
      const topo = new Topology();
      expect(topo.degree(999)).toBe(0);
    });
  });

  describe("endpoints", () => {
    it("should return source and target of a bond", () => {
      const topo = new Topology();
      topo.addBond(42, 5, 10);
      expect(topo.endpoints(42)).toEqual([5, 10]);
    });

    it("should return undefined for non-existent bond", () => {
      const topo = new Topology();
      expect(topo.endpoints(999)).toBeUndefined();
    });
  });

  describe("incident / getBondsForAtom", () => {
    it("should return bond ids incident to a vertex", () => {
      const topo = new Topology();
      topo.addBond(10, 0, 1);
      topo.addBond(20, 0, 2);
      topo.addBond(30, 1, 2);

      const inc = topo.incident(0).sort();
      expect(inc).toEqual([10, 20]);
    });

    it("getBondsForAtom should return Set of bond ids", () => {
      const topo = new Topology();
      topo.addBond(10, 0, 1);
      topo.addBond(20, 0, 2);

      const bonds = topo.getBondsForAtom(0);
      expect(bonds.has(10)).toBe(true);
      expect(bonds.has(20)).toBe(true);
      expect(bonds.size).toBe(2);
    });
  });

  describe("removeBond", () => {
    it("should remove a bond", () => {
      const topo = new Topology();
      topo.addBond(0, 0, 1);
      expect(topo.ecount()).toBe(1);

      topo.removeBond(0);
      expect(topo.ecount()).toBe(0);
      expect(topo.degree(0)).toBe(0);
      expect(topo.degree(1)).toBe(0);
    });

    it("should not throw when removing non-existent bond", () => {
      const topo = new Topology();
      topo.removeBond(999); // should not throw
    });
  });

  describe("removeAtom", () => {
    it("should remove atom and all connected bonds", () => {
      const topo = new Topology();
      topo.addBond(0, 0, 1);
      topo.addBond(1, 0, 2);
      topo.addBond(2, 1, 2);

      const removedEdges = topo.removeAtom(0);
      expect(removedEdges.sort()).toEqual([0, 1]);
      expect(topo.vcount()).toBe(2); // atoms 1 and 2 remain
      expect(topo.ecount()).toBe(1); // only bond 2 remains
    });

    it("should return empty array for isolated atom", () => {
      const topo = new Topology();
      topo.addAtom(5);
      const removed = topo.removeAtom(5);
      expect(removed).toEqual([]);
      expect(topo.vcount()).toBe(0);
    });

    it("cascading removal should update neighbor adjacency", () => {
      const topo = new Topology();
      topo.addBond(0, 0, 1);
      topo.addBond(1, 0, 2);

      topo.removeAtom(0);
      // Atoms 1 and 2 should have no bonds
      expect(topo.degree(1)).toBe(0);
      expect(topo.degree(2)).toBe(0);
    });
  });

  describe("clear", () => {
    it("should remove all data", () => {
      const topo = new Topology();
      topo.addBond(0, 0, 1);
      topo.addBond(1, 1, 2);
      topo.clear();
      expect(topo.vcount()).toBe(0);
      expect(topo.ecount()).toBe(0);
    });
  });
});
