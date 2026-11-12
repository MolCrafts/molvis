import {
  listFragmentTemplates,
  MoleculeLayout,
  SketchComposer,
} from "@molcrafts/molvis-sketch";
import { createSketchPreview } from "../preview";
import { SketchBoardRpc } from "./board_rpc";
import {
  type BridgeSocket,
  type BridgeStatus,
  SketchPageBridge,
} from "./page_bridge";

/**
 * Entry of the sketch page the Python package ships as `molvis/sketch_dist`.
 *
 * Mounts a `SketchComposer` over the whole page. `surface=canvas` drops the
 * tool rails. `surface=preview` is the read-only mode: the MolCrafts preview
 * header (reset view, zoom, fullscreen, PNG / SVG export) and a board a
 * click cannot draw on. `title=` names what it shows. Without a `ws_url` the
 * page is a plain standalone editor.
 */
const search = window.location.search;
const params = new URLSearchParams(search);
const surface = params.get("surface");
const root = document.getElementById("molvis-sketch-root") ?? document.body;
const composer = new SketchComposer({
  gui: surface !== "canvas",
  mode: surface === "preview" ? "readonly" : "edit",
});
composer.mount(root);
const theme = params.get("theme");
const preview = createSketchPreview(composer, {
  title: params.get("title") ?? undefined,
  theme: theme === "light" || theme === "dark" ? theme : undefined,
});

const endpoint = SketchPageBridge.readEndpoint(search);
if (endpoint) {
  const rpc = new SketchBoardRpc(
    composer.board,
    new MoleculeLayout(),
    listFragmentTemplates,
  );
  let connected = false;
  const onStatus = (status: BridgeStatus): void => {
    if (status.kind === "connecting") {
      preview?.setState({ kind: "loading", message: "Connecting to MolVis…" });
    } else if (status.kind === "ready") {
      connected = true;
      const loaded = composer.board.getMoleculeData().atoms.length > 0;
      preview?.setState(
        loaded
          ? { kind: "ready" }
          : { kind: "loading", message: "Waiting for the molecule…" },
      );
    } else {
      const taken =
        status.code === 1013 || /already bound/.test(status.reason ?? "");
      preview?.setState({
        kind: "error",
        message: taken
          ? "This preview is open in another window. Close it there, then reload this page."
          : connected
            ? "Lost the connection to MolVis. Reload this page to reconnect."
            : "Could not reach MolVis.",
      });
    }
  };
  // The molecule arriving is what makes the board ready to look at.
  composer.board.subscribe(() => {
    if (connected && composer.board.getMoleculeData().atoms.length > 0) {
      preview?.setState({ kind: "ready" });
    }
  });
  // A browser WebSocket is a BridgeSocket; the cast only narrows its type.
  new SketchPageBridge(
    endpoint,
    rpc,
    (url) => new WebSocket(url) as unknown as BridgeSocket,
    onStatus,
  ).connect();
}
