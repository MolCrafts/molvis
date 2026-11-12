import fs from "node:fs";
import path from "node:path";

/**
 * Point `@molcrafts/ui` at the sibling checkout while the intake is aligned.
 * The `$` makes the match exact, so `@molcrafts/ui/styles.css` stays on the
 * package export.
 *
 * Source lives outside this repo, so its `react` import would otherwise bind
 * the sibling's copy and break hooks. These aliases keep one React.
 * `page/tsconfig.json` always maps `@molcrafts/ui` at this sibling, so a
 * molvis-only CI typecheck fails until the next publish. The bundler alias
 * is empty when the sibling is absent and then uses the published package,
 * which does not have these exports yet. Publish waits until the intake is aligned.
 */
export function molcraftsUiAlias(pageRoot: string): Record<string, string> {
  const localUi = path.resolve(
    pageRoot,
    "../../molcrafts-ui/packages/ui/src/index.ts",
  );
  if (!fs.existsSync(localUi)) return {};
  const react = path.resolve(pageRoot, "../node_modules/react");
  const reactDom = path.resolve(pageRoot, "../node_modules/react-dom");
  return {
    "@molcrafts/ui$": localUi,
    react$: react,
    "react/jsx-runtime$": path.join(react, "jsx-runtime.js"),
    "react/jsx-dev-runtime$": path.join(react, "jsx-dev-runtime.js"),
    "react-dom$": reactDom,
    "react-dom/client$": path.join(reactDom, "client.js"),
  };
}
