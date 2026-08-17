export type ImpostorTarget = "atom" | "bond";

export interface BufferDef {
  name: string;
  stride: number;
}

export interface WarmupBufferDef extends BufferDef {
  data: Float32Array;
}

export interface ImpostorMaterialSpec {
  target: ImpostorTarget;
  materialName: string;
  shaderName: string;
  attributes: string[];
  uniforms: string[];
  bufferDefs: BufferDef[];
  warmupBuffers: WarmupBufferDef[];
}

const COMMON_UNIFORMS = [
  "view",
  "projection",
  "lightDir",
  "lightAmbient",
  "lightDiffuse",
  "lightSpecular",
  "lightSpecularPower",
  "backgroundColor",
  "atomShadingMode",
  "atomOutline",
  "bondShadingMode",
  "bondOutline",
  "uPickingEnabled",
];

export const ATOM_IMPOSTOR_SPEC: ImpostorMaterialSpec = {
  target: "atom",
  materialName: "atomMat_impostor",
  shaderName: "sphereImpostor",
  attributes: [
    "position",
    "uv",
    "instanceData",
    "instanceColor",
    "instanceStyle",
    "instancePickingColor",
  ],
  uniforms: COMMON_UNIFORMS,
  bufferDefs: [
    { name: "matrix", stride: 16 },
    { name: "instanceData", stride: 4 },
    { name: "instanceColor", stride: 4 },
    { name: "instanceStyle", stride: 4 },
    { name: "instancePickingColor", stride: 4 },
  ],
  warmupBuffers: [
    {
      name: "instanceData",
      stride: 4,
      data: new Float32Array([0, 0, 0, 0.5]),
    },
    {
      name: "instanceColor",
      stride: 4,
      data: new Float32Array([1, 1, 1, 1]),
    },
    {
      name: "instanceStyle",
      stride: 4,
      data: new Float32Array([1, 0, 0, 0]),
    },
    {
      name: "instancePickingColor",
      stride: 4,
      data: new Float32Array([0, 0, 0, 1]),
    },
  ],
};

export const BOND_IMPOSTOR_SPEC: ImpostorMaterialSpec = {
  target: "bond",
  materialName: "bondMat_impostor",
  shaderName: "bondImpostor",
  attributes: [
    "position",
    "uv",
    "instanceData0",
    "instanceData1",
    "instanceColor0",
    "instanceColor1",
    "instanceSplit",
    "instancePickingColor",
  ],
  uniforms: COMMON_UNIFORMS,
  bufferDefs: [
    { name: "matrix", stride: 16 },
    { name: "instanceData0", stride: 4 },
    { name: "instanceData1", stride: 4 },
    { name: "instanceColor0", stride: 4 },
    { name: "instanceColor1", stride: 4 },
    { name: "instanceSplit", stride: 4 },
    { name: "instancePickingColor", stride: 4 },
  ],
  warmupBuffers: [
    {
      name: "instanceData0",
      stride: 4,
      data: new Float32Array([0, 0, 0, 0.1]),
    },
    {
      name: "instanceData1",
      stride: 4,
      data: new Float32Array([0, 1, 0, 1]),
    },
    {
      name: "instanceColor0",
      stride: 4,
      data: new Float32Array([1, 1, 1, 1]),
    },
    {
      name: "instanceColor1",
      stride: 4,
      data: new Float32Array([1, 1, 1, 1]),
    },
    {
      name: "instanceSplit",
      stride: 4,
      data: new Float32Array([0, 0, 0, 0]),
    },
    {
      name: "instancePickingColor",
      stride: 4,
      data: new Float32Array([0, 0, 0, 1]),
    },
  ],
};

export function getImpostorMaterialSpec(
  target: ImpostorTarget,
): ImpostorMaterialSpec {
  return target === "atom" ? ATOM_IMPOSTOR_SPEC : BOND_IMPOSTOR_SPEC;
}
