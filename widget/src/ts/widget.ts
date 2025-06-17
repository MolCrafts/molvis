import { Logger } from "tslog";
import { Molvis } from "@molvis/core/src/app";
import type { ModelType } from "./types";
import { JsonRpcHandler } from "./jsonrpc";

const logger = new Logger({ name: "molvis-widget" });

export class MolvisWidget {
  private canvas_container: HTMLElement | null;
  private canvas: HTMLCanvasElement;
  private molvis: Molvis;
  private _model: ModelType;
  private jrpc_handler: JsonRpcHandler;
  private session_id: number;
  constructor(model: ModelType) {
    const width = model.get("width");
    const height = model.get("height");

    this.canvas = document.createElement("canvas");
    this.session_id = model.get("session_id");
    this.canvas.id = `molvis-widget-${this.session_id}`;
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas_container = null;
    this.molvis = new Molvis(this.canvas);
    this._model = model;

    this.jrpc_handler = new JsonRpcHandler(this.molvis);
    model.on("msg:custom", this.handle_custom_message);
  }

  public handle_custom_message = async (msg: string, buffers: DataView[] = []) => {
    const cmd = JSON.parse(msg);
    try {
      const response = await this.jrpc_handler.execute(cmd, buffers);
      logger.info("Command executed successfully:", response);
    } catch (error) {
      logger.error("Error handling custom message:", error);
    }
  };

  public attach = (el: HTMLElement) => {
    // jupyter seems clean up output when re-render
    this.detach();
    el.appendChild(this.canvas);
    this.canvas_container = el;
    this.resize();
  };

  public detach = () => {
    if (this.canvas_container) {
      this.canvas_container.removeChild(this.canvas);
      this.canvas_container = null;
    }
  };

  public start = () => {
    this.molvis.render();
  };

  public stop = () => {
    this.molvis.stop();
  };

  public resize = () => {
    this.molvis.resize();
  };
}
