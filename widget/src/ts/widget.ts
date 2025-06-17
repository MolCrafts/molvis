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
    // const width = model.get("width");
    // const height = model.get("height");

    this.canvas = document.createElement("canvas");
    this.session_id = model.get("session_id");
    this.canvas.id = `molvis-widget-${this.session_id}`;
    
    this.canvas.style.margin = "0";
    this.canvas.style.padding = "0";
    this.canvas.style.border = "none";
    this.canvas.style.outline = "none";
    this.canvas.style.display = "block";
    
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
    this.detach();
    
    el.style.margin = "0";
    el.style.padding = "0";
    el.style.overflow = "hidden";
    
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
    if (!this.canvas_container) return;

    const modelWidth = this._model.get("width") || 800;
    const modelHeight = this._model.get("height") || 600;
    
    this.canvas_container.style.width = `${modelWidth}px`;
    this.canvas_container.style.height = `${modelHeight}px`;
    
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = modelWidth * dpr;
    this.canvas.height = modelHeight * dpr;
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    
    // const ctx = this.canvas.getContext('2d');
    // if (ctx) {
    //   ctx.scale(dpr, dpr);
    // }
    
    this.molvis.resize();
  };
}
