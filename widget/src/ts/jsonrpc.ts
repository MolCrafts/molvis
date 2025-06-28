import type { Molvis } from "@molvis/core";
import { Logger } from "tslog";
import type { JsonRPCRequest } from "./types";
import { createErrorResponse, createSuccessResponse } from "./types";

const logger = new Logger({ name: "molvis-jsonrpc" });

export class JsonRpcHandler {
  private app: Molvis;

  constructor(app: Molvis) {
    this.app = app;
  }

  public async execute(request: JsonRPCRequest, buffers: DataView[] = []) {
    const { jsonrpc, method, params, id } = request;
    if (jsonrpc !== "2.0") {
      return createErrorResponse(id, -32600, "Invalid JSON-RPC version");
    }

    try {
      // const processedParams = await this.processBuffers(params, buffers);
      // logger.info("Processed params:", processedParams);
      
      const response = this.callFunction(id, method, params);
      logger.info(`Method ${method} executed successfully`);
      return response;
    } catch (error) {
      logger.error(`Error executing method ${method}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return createErrorResponse(id, -32603, `Internal error: ${errorMessage}`);
    }
  }

  // private async processBuffers(
  //   params: Record<string, unknown>,
  //   buffers: DataView[],
  // ): Promise<Record<string, unknown>> {
  //   for (const key in params) {
  //     const value = params[key];
  //     if (typeof value === "string") {
  //       if (value.startsWith("__buffer")) {

  //         } else {
            
  //         }
  //       }
  //     }
  //   }
  //   return params;
  // }

  private callFunction(
    id: number | null,
    method: string,
    params: Record<string, unknown>,
  ) {
    const result = this.app.execute(method, params);
    return createSuccessResponse(id, result);
  }
}
