/**
 * Representation-level frame draw paths extracted from {@link Artist}.
 * Keeps atom/bond GPU upload logic out of the Artist façade so new
 * representation backends can land beside these functions without
 * growing `artist.ts`.
 */

import { Color3, type Mesh } from "@babylonjs/core";
import type { Block, Frame } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "../modifiers/ColorByPropertyModifier";
import { normalizeElement } from "../system/elements";
import { DType } from "../utils/dtype";
import {
  type AtomBufferOptions,
  buildAtomBuffers,
  buildAtomColorOnly,
} from "./atom_buffer";
import { buildBondBuffers } from "./bond_buffer";
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
  resolveAtomColorForBonds: (atomsBlock: Block) => Float32Array;
  computeBondMIDisplacements: (
    frame: Frame,
    atomsBlock: Block,
    bondsBlock: Block,
  ) => Float64Array | undefined;
}

function readElements(atomsBlock: Block): string[] | undefined {
  return atomsBlock.dtype("element") === DType.String
    ? (atomsBlock.copyColStr("element") as string[])
    : undefined;
}

/** Atom indices hidden by conventional skeletal notation (C-bound H). */
export function carbonBoundHydrogens(
  atomsBlock: Block,
  bondsBlock: Block | undefined | null,
): Set<number> {
  const hidden = new Set<number>();
  const elements = readElements(atomsBlock);
  if (!elements || !bondsBlock) return hidden;
  const iAtoms = bondsBlock.viewColU32("atomi");
  const jAtoms = bondsBlock.viewColU32("atomj");
  if (!iAtoms || !jAtoms) return hidden;

  for (let b = 0; b < bondsBlock.nrows(); b++) {
    const i = iAtoms[b];
    const j = jAtoms[b];
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

  const atomBuffers = buildAtomBuffers(
    atomsBlock,
    host.app.styleManager,
    host.atomMesh.uniqueId,
    options,
  );

  host.app.world.sceneIndex.registerAtomFrame({
    frame,
    mesh: host.atomMesh,
    block: atomsBlock,
    buffers: atomBuffers,
  });
  syncRepresentationLabels(host, frame, atomsBlock);
}

export async function drawBondsRepresentation(
  host: RepresentationDrawHost,
  frame: Frame,
  options?: { radii?: number; impostor?: boolean; visible?: boolean[] },
): Promise<void> {
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

  // When atoms carry property / cluster color overrides, force split bond
  // coloring and sample colors from the *frame* block — not a possibly-stale
  // registered GPU buffer — so sticks stay in lockstep with atom recolor.
  const hasAtomColorOverride =
    atomsBlock.dtype(COLOR_OVERRIDE_R) !== undefined &&
    atomsBlock.dtype(COLOR_OVERRIDE_G) !== undefined &&
    atomsBlock.dtype(COLOR_OVERRIDE_B) !== undefined;
  const atomColor = hasAtomColorOverride
    ? buildAtomColorOnly(atomsBlock, host.app.styleManager)
    : host.resolveAtomColorForBonds(atomsBlock);
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

/** Fallback color buffer when atom layer is not registered. */
export function resolveAtomColorForBondsFallback(
  app: MolvisApp,
  atomsBlock: Block,
): Float32Array {
  const atomState = app.world.sceneIndex.meshRegistry.getAtomState();
  const registered = atomState?.buffers.get("instanceColor")?.data as
    | Float32Array
    | undefined;
  if (registered) return registered;
  return buildAtomColorOnly(atomsBlock, app.styleManager);
}
