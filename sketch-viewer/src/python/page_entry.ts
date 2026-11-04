import {
  listFragmentTemplates,
  MoleculeLayout,
  SketchComposer,
} from "@molcrafts/molvis-sketch";
import { SketchBoardRpc } from "./board_rpc";
import { type BridgeSocket, SketchPageBridge } from "./page_bridge";

/**
 * Entry of the sketch page the Python package ships as `molvis/sketch_dist`.
 *
 * Mounts a `SketchComposer` over the whole page (`surface=canvas` drops the
 * tool rails) and, when the URL names a `ws_url`, dials the Python transport
 * and answers `sketch.*` requests against the composer's board. Without a
 * `ws_url` the page is a plain standalone editor.
 */
const search = window.location.search;
const surface = new URLSearchParams(search).get("surface");
const root = document.getElementById("molvis-sketch-root") ?? document.body;
const composer = new SketchComposer({ gui: surface !== "canvas" });
composer.mount(root);

const endpoint = SketchPageBridge.readEndpoint(search);
if (endpoint) {
  const rpc = new SketchBoardRpc(
    composer.board,
    new MoleculeLayout(),
    listFragmentTemplates,
  );
  // A browser WebSocket is a BridgeSocket; the cast only narrows its type.
  new SketchPageBridge(
    endpoint,
    rpc,
    (url) => new WebSocket(url) as unknown as BridgeSocket,
  ).connect();
}
