/**
 * Project molrs `keysDocument()` / `schemaDocument()` into the TypeScript mirror
 * and the API column table. The strings are not written here.
 *
 *   node --experimental-wasm-modules core/scripts/gen-keys.mjs
 *   node --experimental-wasm-modules core/scripts/gen-keys.mjs --check
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { keysDocument, schemaDocument } from "@molcrafts/molrs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const keysPath = resolve(root, "core/src/keys.ts");
const docsPath = resolve(root, "docs/api/typescript.md");
const check = process.argv.includes("--check");

// Bundler glue imports the wasm module and calls `__wbindgen_start` on load.
const keys = keysDocument();
const schema = schemaDocument();

const keysText = renderKeys(keys);
const docsText = renderDocs(readFileSync(docsPath, "utf8"), schema);

if (check) {
  const drift = [];
  if (readFileSync(keysPath, "utf8") !== keysText) drift.push(keysPath);
  if (readFileSync(docsPath, "utf8") !== docsText) drift.push(docsPath);
  if (drift.length) {
    console.error(
      `generated from molrs, out of date:\n${drift.map((p) => `  ${p}`).join("\n")}\nregenerate: node --experimental-wasm-modules core/scripts/gen-keys.mjs`,
    );
    process.exit(1);
  }
} else {
  writeFileSync(keysPath, keysText);
  writeFileSync(docsPath, docsText);
}

function renderKeys(doc) {
  const columnByValue = new Map(doc.columns.map((c) => [c.value, c.constName]));
  const blockByValue = new Map(doc.blocks.map((b) => [b.value, b.constName]));
  const lines = [
    "/**",
    " * Generated from molrs `keysDocument()`. Do not edit.",
    " *",
    " * Column keys, ordered groups, block names, and frame-meta keys. The",
    " * strings live in the Rust schema tables. `ATOMS_BLOCK` / `BONDS_BLOCK`",
    " * alias `ATOMS` / `BONDS` and do not introduce a name.",
    " */",
    "",
  ];
  for (const col of doc.columns) {
    lines.push(`export const ${col.constName} = ${JSON.stringify(col.value)};`);
  }
  lines.push("");
  for (const group of doc.groups) {
    const members = group.values.map((value) => {
      const name = columnByValue.get(value);
      if (!name)
        throw new Error(
          `group ${group.constName} member ${value} is not a column`,
        );
      return name;
    });
    lines.push(
      `export const ${group.constName} = [${members.join(", ")}] as const;`,
    );
  }
  lines.push("");
  for (const meta of doc.meta) {
    lines.push(
      `export const ${meta.constName} = ${JSON.stringify(meta.value)};`,
    );
  }
  lines.push("");
  for (const block of doc.blocks) {
    lines.push(
      `export const ${block.constName} = ${JSON.stringify(block.value)};`,
    );
  }
  lines.push("");
  for (const group of doc.blockGroups) {
    const members = group.values.map((value) => {
      const name = blockByValue.get(value);
      if (!name)
        throw new Error(
          `group ${group.constName} member ${value} is not a block`,
        );
      return name;
    });
    lines.push(
      `export const ${group.constName} = [${members.join(", ")}] as const;`,
    );
  }
  if (!blockByValue.has("atoms") || !blockByValue.has("bonds")) {
    throw new Error("schema is missing atoms or bonds");
  }
  lines.push("");
  lines.push("export const ATOMS_BLOCK = ATOMS;");
  lines.push("export const BONDS_BLOCK = BONDS;");
  lines.push("");
  return lines.join("\n");
}

function renderDocs(source, doc) {
  const start = "<!-- schema-columns:start -->";
  const end = "<!-- schema-columns:end -->";
  const at = source.indexOf(start);
  const to = source.indexOf(end);
  if (at < 0 || to < at) {
    throw new Error("docs/api/typescript.md is missing schema-columns markers");
  }
  const rows = ["| Block | Columns |", "|---|---|"];
  for (const block of doc.blocks) {
    const cols = [...block.required, ...block.optional];
    const seen = new Set();
    const unique = cols.filter((key) =>
      seen.has(key) ? false : seen.add(key),
    );
    const cell = unique.map((key) => `\`${key}\``).join(", ");
    rows.push(`| \`${block.name}\` | ${cell} |`);
  }
  const body = `${start}\n${rows.join("\n")}\n${end}`;
  return source.slice(0, at) + body + source.slice(to + end.length);
}
