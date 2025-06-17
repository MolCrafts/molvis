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

    this.canvas = document.createElement("canvas");
    this.session_id = model.get("session_id");
    this.canvas.id = `molvis-widget-${this.session_id}`;
    this.canvas.className = "molvis-canvas";
    
    // Get initial size from model
    const modelWidth = model.get("width") || 800;
    const modelHeight = model.get("height") || 600;
    
    // Set canvas properties
    this.canvas.width = modelWidth;
    this.canvas.height = modelHeight;
    this.canvas.style.width = `${modelWidth}px`;
    this.canvas.style.height = `${modelHeight}px`;
    this.canvas.style.margin = "0";
    this.canvas.style.padding = "0";
    this.canvas.style.border = "none";
    this.canvas.style.outline = "none";
    this.canvas.style.display = "block";
    this.canvas.style.pointerEvents = "auto";
    this.canvas.style.touchAction = "none";
    this.canvas.style.maxWidth = "100%";
    this.canvas.style.maxHeight = "100%";
    
    this.canvas_container = null;
    this.molvis = new Molvis(this.canvas);
    this._model = model;

    this.jrpc_handler = new JsonRpcHandler(this.molvis);
    model.on("msg:custom", this.handle_custom_message);
    
    // Listen for size changes
    model.on("change:width", this.resize);
    model.on("change:height", this.resize);
  }

  public handle_custom_message = async (msg: string, buffers: DataView[] = []) => {
    const cmd = JSON.parse(msg);
    const response = await this.jrpc_handler.execute(cmd, buffers);
    this._model.send("msg:custom", JSON.stringify(response));
  };

  public attach = (el: HTMLElement) => {
    this.detach();
    if (!this.molvis.is_running) {
      this.molvis.render();
    }
    
    // Set container styles to ensure proper sizing
    const modelWidth = this._model.get("width") || 800;
    const modelHeight = this._model.get("height") || 600;
    
    el.style.margin = "0";
    el.style.padding = "0";
    el.style.overflow = "hidden";
    el.style.pointerEvents = "auto";
    el.style.width = `${modelWidth}px`;
    el.style.height = `${modelHeight}px`;
    el.style.display = "block";
    el.style.position = "relative";
    el.style.background = "transparent";
    el.style.backgroundColor = "transparent";
    
    this.canvas.style.pointerEvents = "auto";
    this.canvas.style.touchAction = "none";
    
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
    
    // Set container size
    this.canvas_container.style.width = `${modelWidth}px`;
    this.canvas_container.style.height = `${modelHeight}px`;
    this.canvas_container.style.maxWidth = `${modelWidth}px`;
    this.canvas_container.style.maxHeight = `${modelHeight}px`;
    
    // Set canvas size
    this.canvas.width = modelWidth;
    this.canvas.height = modelHeight;
    this.canvas.style.width = `${modelWidth}px`;
    this.canvas.style.height = `${modelHeight}px`;
    this.canvas.style.maxWidth = "100%";
    this.canvas.style.maxHeight = "100%";
    
    this.molvis.resize();
  };
}
