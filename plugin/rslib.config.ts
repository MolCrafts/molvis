import { defineConfig } from "@rslib/core";

/**
 * Unbundled ESM library for `@molcrafts/molvis-plugin`.
 * Peer packages stay external so plugins and the host share one React / stage.
 */
const watching = process.argv.includes("--watch");

export default defineConfig({
  lib: [
    {
      format: "esm",
      bundle: false,
      dts: true,
      source: {
        // Emit every module so subpath `./ui` resolves without a second bundle.
        entry: { index: "./src/**/*.{ts,tsx}" },
      },
      output: {
        target: "web",
        cleanDistPath: !watching,
        // `./css` subpath export — the bundler emits it; no post-build script.
        copy: [{ from: "./src/styles/shadcn.css", to: "styles/shadcn.css" }],
        externals: [
          "react",
          "react-dom",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "@molcrafts/molvis-stage",
          // dist re-exports `@molcrafts/molvis-core/{command,events}` as bare
          // specifiers; keep them external explicitly, not by accident.
          "@molcrafts/molvis-core",
          "@radix-ui/react-slot",
          "@radix-ui/react-checkbox",
          "@radix-ui/react-select",
          "class-variance-authority",
          "clsx",
          "tailwind-merge",
          "lucide-react",
        ],
      },
    },
  ],
});
