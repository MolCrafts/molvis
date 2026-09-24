/**
 * Representation-level frame draw paths extracted from {@link Artist}.
 * Keeps atom/bond GPU upload logic out of the Artist façade so new
 * representation backends can land beside these functions without
 * growing `artist.ts`.
 */

import { Color3, type Mesh } from "@babylonjs/core";
import { toRowIndex } from "@molcrafts/molvis-core";
import type { Block, Frame } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "../color_override_keys";
import { normalizeElement } from "../system/elements";
import {
  type AtomBufferOptions,
  buildAtomBuffers,
  buildAtomColorOnly,
} from "./atom_buffer";
import { buildBondBuffers } from "./bond_buffer";
import { BondTopology } from "./bond_topology";
import { type LabelRenderer, skeletalLabelFontSize } from "./label_renderer";
import type { ImpostorTarget } from "./material_spec";

export interface RepresentationDrawHost {
  app: MolvisApp;
  atomMesh: Mesh;
  bondMesh: Mesh;
  labelRenderer: LabelRenderer;
  ensureShadersForVisibleGeometry: (targets: ImpostorTarget[]) => Promise<void>;
  collectVisibleTargets: (counts: {
    atomCount: number;
    bondCount: number;
  }) => ImpostorTarget[];
  computeBondMIDisplacements: (
    frame: Frame,
    atomsBlock: Block,
    bondsBlock: Block,
  ) => Float64Array | undefined;
}

function readElements(atomsBlock: Block): string[] | undefined {
  return atomsBlock.hasStr("element")
    ? (atomsBlock.getStr("element") as string[])
    : undefined;
}

// Origin-sentinel dropping is a molpack convention (see system/occupancy.ts):
// it hides rows from the canvas, so it must not be silent. Announce the first
// time (per app) the heuristic starts hiding rows, naming the count. Dedupe on
// the dropping/not-dropping transition so scrubbing a growth trajectory does
// not spam the status bar every frame.
const lastSentinelDrop = new WeakMap<MolvisApp, number>();

function announceOriginSentinelDrop(app: MolvisApp, dropped: number): void {
  const wasDropping = (lastSentinelDrop.get(app) ?? 0) > 0;
  lastSentinelDrop.set(app, dropped);
  if (dropped > 0 && !wasDropping) {
    app.events.emit("status-message", {
      text: `Hiding ${dropped} unplaced origin-sentinel atom(s) parked at (0,0,0) — molpack convention.`,
      type: "info",
    });
  }
}

/** Atom indices hidden by conventional skeletal notation (C-bound H). */
export function carbonBoundHydrogens(
  atomsBlock: Block,
  bondsBlock: Block | undefined | null,
): Set<number> {
  const hidden = new Set<number>();
  const elements = readElements(atomsBlock);
  if (!elements || !bondsBlock || bondsBlock.nrows() === 0) return hidden;
  const iAtoms = bondsBlock.viewColU32("atomi");
  const jAtoms = bondsBlock.viewColU32("atomj");

  for (let b = 0; b < bondsBlock.nrows(); b++) {
    const i = toRowIndex(iAtoms[b]);
    const j = toRowIndex(jAtoms[b]);
    const ei = normalizeElement(elements[i] ?? "");
    const ej = normalizeElement(elements[j] ?? "");
    if (ei === "C" && ej === "H") hidden.add(j);
    if (ej === "C" && ei === "H") hidden.add(i);
  }
  return hidden;
}

export async function drawAtomsRepresentation(
  host: RepresentationDrawHost,
  frame: Frame,
  options?: AtomBufferOptions & { impostor?: boolean },
): Promise<void> {
  const atomsBlock = frame.getBlock("atoms");
  if (!atomsBlock || atomsBlock.nrows() === 0) return;

  await host.ensureShadersForVisibleGeometry(
    host.collectVisibleTargets({
      atomCount: atomsBlock.nrows(),
      bondCount: 0,
    }),
  );

  const built = buildAtomBuffers(
    atomsBlock,
    host.app.styleManager,
    host.atomMesh.uniqueId,
    options,
    frame,
  );

  announceOriginSentinelDrop(
    host.app,
    built.instanceMap ? atomsBlock.nrows() - built.instanceMap.length : 0,
  );

  host.app.world.sceneIndex.registerAtomFrame({
    frame,
    mesh: host.atomMesh,
    block: atomsBlock,
    buffers: built.buffers,
    instanceMap: built.instanceMap,
  });
  syncRepresentationLabels(host, frame, atomsBlock);
}

/**
 * Full bond build. Resolves to the {@link BondTopology} the buffers were
 * built from so the Artist can reuse it on position-only refreshes.
 *
 * Endpoint colors come from {@link buildAtomColorOnly} — frame rows plus the
 * style manager. See that function for why the atom layer's registered color
 * buffer is not interchangeable with it.
 */
export async function drawBondsRepresentation(
  host: RepresentationDrawHost,
  frame: Frame,
  options?: { radii?: number; impostor?: boolean; visible?: boolean[] },
): Promise<BondTopology | undefined> {
  const atomsBlock = frame.getBlock("atoms");
  const bondsBlock = frame.getBlock("bonds");
  if (!atomsBlock || !bondsBlock || bondsBlock.nrows() === 0) return;

  await host.ensureShadersForVisibleGeometry(
    host.collectVisibleTargets({
      atomCount: atomsBlock.nrows(),
      bondCount: bondsBlock.nrows(),
    }),
  );

  const sceneIndex = host.app.world.sceneIndex;
  const representation = host.app.styleManager.getRepresentation();
  const hiddenHydrogens = representation.hideCarbonHydrogens
    ? carbonBoundHydrogens(atomsBlock, bondsBlock)
    : new Set<number>();
  const bondStyle = host.app.styleManager.getBondStyle(1);
  const bondColor = Color3.FromHexString(bondStyle.color).toLinearSpace();

  // Atoms carrying property / cluster overrides can differ atom by atom, so one
  // stick color would hide the property: force the split pass, which samples the
  // per-atom colors.
  const hasAtomColorOverride =
    atomsBlock.dtype(COLOR_OVERRIDE_R) !== undefined &&
    atomsBlock.dtype(COLOR_OVERRIDE_G) !== undefined &&
    atomsBlock.dtype(COLOR_OVERRIDE_B) !== undefined;
  const atomColor = buildAtomColorOnly(atomsBlock, host.app.styleManager);
  const bondColorMode = hasAtomColorOverride
    ? "split"
    : representation.bondColorMode;

  const visible = options?.visible;
  const bondResult = buildBondBuffers(
    bondsBlock,
    atomsBlock,
    atomColor,
    host.bondMesh.uniqueId,
    {
      radius: options?.radii ?? host.app.styleManager.getBondStyle(1).radius,
      visible: visible ? (i: number) => visible[i] : undefined,
      visibleBond: (_bondIndex, i, j) =>
        !hiddenHydrogens.has(i) && !hiddenHydrogens.has(j),
      orderMode: representation.bondOrderMode,
      colorMode: bondColorMode,
      bondColor: [bondColor.r, bondColor.g, bondColor.b, bondStyle.alpha ?? 1],
      miDisplacements: host.computeBondMIDisplacements(
        frame,
        atomsBlock,
        bondsBlock,
      ),
    },
  );
  if (!bondResult) return;

  sceneIndex.registerBondFrame({
    frame,
    mesh: host.bondMesh,
    block: bondsBlock,
    buffers: bondResult.buffers,
    instanceCount: bondResult.instanceCount,
    instanceMap: bondResult.instanceMap,
  });
  return BondTopology.of(bondsBlock);
}

function syncRepresentationLabels(
  host: RepresentationDrawHost,
  frame: Frame,
  atomsBlock: Block,
): void {
  const representation = host.app.styleManager.getRepresentation();
  if (representation.labels !== "skeletal") {
    host.labelRenderer.clearLabels();
    return;
  }

  const elements = readElements(atomsBlock);
  const x = atomsBlock.viewColF("x");
  const y = atomsBlock.viewColF("y");
  const z = atomsBlock.viewColF("z");
  if (!elements || !x || !y || !z) {
    host.labelRenderer.clearLabels();
    return;
  }

  const hiddenHydrogens = carbonBoundHydrogens(
    atomsBlock,
    frame.getBlock("bonds"),
  );
  const indices: number[] = [];
  const colors = new Array<string>(atomsBlock.nrows());
  for (let i = 0; i < atomsBlock.nrows(); i++) {
    const element = normalizeElement(elements[i] ?? "");
    colors[i] = host.app.styleManager.getAtomStyle(element).color;
    if (element !== "C" && !hiddenHydrogens.has(i)) indices.push(i);
  }

  const background = host.app.world.scene.clearColor;
  const luma =
    background.r * 0.2126 + background.g * 0.7152 + background.b * 0.0722;
  const renderH = host.app.world.scene.getEngine().getRenderHeight();
  host.labelRenderer.setConfig({
    mode: "all",
    template: "{element}",
    fontSize: skeletalLabelFontSize(renderH),
    fontWeight: "bold",
    maxVisible: 512,
  });
  host.labelRenderer.build({
    count: atomsBlock.nrows(),
    x,
    y,
    z,
    elements,
    indices,
    colors,
    outlineColor: luma > 0.42 ? "#111827" : "#FFFFFF",
    outlineWidth: representation.outlineEnabled ? 4 : 2,
  });
}
