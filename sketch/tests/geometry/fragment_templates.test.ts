import { describe, expect, it } from "@rstest/core";
import { fragmentPreviewSvg } from "../../src/geometry/fragment_preview";
import {
  getFragmentTemplate,
  listFragmentCategories,
  listFragmentTemplates,
} from "../../src/geometry/fragment_templates";

describe("fragment_templates", () => {
  it("catalog has categories and stable ids", () => {
    const categories = listFragmentCategories();
    expect(categories.map((c) => c.id)).toEqual(["groups", "rings", "fused"]);
    const ids = listFragmentTemplates().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getFragmentTemplate("oh")?.label).toBe("Hydroxyl");
    expect(getFragmentTemplate("missing")).toBeNull();
  });

  it("every template has valid rootIndex and non-empty geometry", () => {
    for (const template of listFragmentTemplates()) {
      expect(template.data.atoms.length).toBeGreaterThan(0);
      expect(template.rootIndex).toBeGreaterThanOrEqual(0);
      expect(template.rootIndex).toBeLessThan(template.data.atoms.length);
      for (const bond of template.data.bonds) {
        expect(bond.i).toBeGreaterThanOrEqual(0);
        expect(bond.j).toBeGreaterThanOrEqual(0);
        expect(bond.i).toBeLessThan(template.data.atoms.length);
        expect(bond.j).toBeLessThan(template.data.atoms.length);
      }
    }
  });

  it("preview svg is a structure diagram without text labels in menu use", () => {
    const phenyl = getFragmentTemplate("phenyl");
    expect(phenyl).not.toBeNull();
    const svg = fragmentPreviewSvg(phenyl!, { width: 48, height: 48 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<line");
  });

  it("phenyl is a ring (aryl), not a functional group", () => {
    const phenyl = getFragmentTemplate("phenyl");
    expect(phenyl?.category).toBe("rings");
    const groups = listFragmentCategories().find((c) => c.id === "groups");
    expect(groups?.templates.some((t) => t.id === "phenyl")).toBe(false);
    const rings = listFragmentCategories().find((c) => c.id === "rings");
    expect(rings?.templates.some((t) => t.id === "phenyl")).toBe(true);
  });

  it("heteroaromatic five-rings use Kekulé doubles (not all-single aliphatic)", () => {
    for (const id of ["furan", "thiophene", "pyrrole"] as const) {
      const t = getFragmentTemplate(id);
      expect(t).not.toBeNull();
      const doubles = t!.data.bonds.filter((b) => b.order >= 2);
      expect(doubles.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("menu thumbnails scale labels below the full-export 12px floor", () => {
    const pyridine = getFragmentTemplate("pyridine");
    expect(pyridine).not.toBeNull();
    const svg = fragmentPreviewSvg(pyridine!, {
      width: 48,
      height: 48,
      padding: 4,
    });
    const fonts = [...svg.matchAll(/font-size="([^"]+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(fonts.length).toBeGreaterThan(0);
    expect(Math.max(...fonts)).toBeLessThan(12);
    // Label knockout must not be transparent (bonds would show through N).
    expect(svg).toContain("var(--msk-stage-bg");
  });

  it("naphthalene is C10H8 topology: 10 carbons, fused (connected), not two benzenes", () => {
    const template = getFragmentTemplate("naphthalene");
    expect(template).not.toBeNull();
    const { atoms, bonds } = template!.data;
    // Two separate hexagons would be 12 atoms; fused naphthalene is 10.
    expect(atoms.length).toBe(10);
    expect(atoms.every((a) => a.element === "C")).toBe(true);
    // 11 unique bonds in naphthalene skeleton (each ring 6, share 1 → 11)
    expect(bonds.length).toBe(11);

    // Graph connectivity: single component
    const adj = new Map<number, number[]>();
    for (let i = 0; i < atoms.length; i++) adj.set(i, []);
    for (const b of bonds) {
      adj.get(b.i)!.push(b.j);
      adj.get(b.j)!.push(b.i);
    }
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length > 0) {
      const u = stack.pop()!;
      for (const v of adj.get(u)!) {
        if (!seen.has(v)) {
          seen.add(v);
          stack.push(v);
        }
      }
    }
    expect(seen.size).toBe(10);

    // Bridge carbons (fusion) have degree 3; peripheral carbons degree 2
    const degrees = atoms.map((_, i) => adj.get(i)!.length);
    expect(degrees.filter((d) => d === 3).length).toBe(2);
    expect(degrees.filter((d) => d === 2).length).toBe(8);
    expect(template!.rootIndex).toBe(0);
  });
});
