import type { Molvis } from "@molvis/app";
import { Logger } from "tslog";
import { tableFromIPC, type Table } from "@apache-arrow/ts";
import type { JsonRPCRequest } from "./types";
import { createErrorResponse, createSuccessResponse } from "./types";
import { HDF5Parser, type HDF5Metadata } from "./hdf5-parser";

const logger = new Logger({ name: "molvis-jsonrpc" });

export class JsonRpcHandler {
  private app: Molvis;
  private hdf5Parser: HDF5Parser;

  constructor(app: Molvis) {
    this.app = app;
    this.hdf5Parser = HDF5Parser.getInstance();
  }

  public async execute(request: JsonRPCRequest, buffers: DataView[] = []) {
    const { jsonrpc, method, params, id } = request;

    if (jsonrpc !== "2.0") {
      return createErrorResponse(id, -32600, "Invalid JSON-RPC version");
    }

    try {
      const processedParams = await this.processBuffers(params, buffers);
      logger.info("Processed params:", processedParams);
      
      const response = this.callFunction(id, method, processedParams);
      logger.info(`Method ${method} executed successfully`);
      return response;
    } catch (error) {
      logger.error(`Error executing method ${method}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return createErrorResponse(id, -32603, `Internal error: ${errorMessage}`);
    }
  }

  private async processBuffers(
    params: Record<string, unknown>,
    buffers: DataView[],
  ): Promise<Record<string, unknown>> {
    for (const key in params) {
      const value = params[key];
      if (typeof value === "string") {
        if (value.startsWith("__buffer")) {
          const index = value.split(".")[1];
          const bufferIndex = Number.parseInt(index);
          const buffer = buffers[bufferIndex];
          
          if (!buffer) {
            logger.warn(`Buffer ${bufferIndex} not found for key ${key}`);
            continue;
          }

          // Check if this is HDF5 data based on method or format param
          const format = (params as Record<string, unknown>).format;
          if (format === "hdf5") {
            try {
              // Process HDF5 buffer - convert DataView to Uint8Array
              const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
              logger.info(`Processing HDF5 buffer ${bufferIndex} for key ${key}: ${uint8Array.length} bytes`);
              
              // Parse HDF5 data using our parser
              const metadata = (params as Record<string, unknown>).metadata as HDF5Metadata;
              const molecularData = await this.hdf5Parser.parseHDF5(uint8Array, metadata);
              logger.info(`Parsed HDF5 data:`, molecularData.metadata);
              
              params[key] = molecularData;
            } catch (error) {
              logger.error(`Failed to process HDF5 buffer for key ${key}:`, error);
              throw new Error(`Failed to process HDF5 buffer for ${key}`);
            }
          } else {
            // Legacy Arrow format processing
            try {
              const table = tableFromIPC(buffer);
              const tableData = this.parseArrowTable(table);
              logger.info(`Parsed arrow buffer ${bufferIndex} for key ${key}:`, { 
                rows: table.numRows, 
                columns: table.schema.fields.map(f => f.name) 
              });
              params[key] = tableData;
            } catch (error) {
              logger.error(`Failed to parse arrow table for key ${key}:`, error);
              throw new Error(`Failed to parse arrow table for ${key}`);
            }
          }
        }
      }
    }
    return params;
  }

  private parseArrowTable(table: Table) {
    const data: Record<string, unknown> = {};
    const columns = table.schema.fields.map((field) => field.name);
    for (const column of columns) {
      // const type = column.type;
      const values = table.getChild(column)?.toArray();
      // if (type === "string") {
      //   data[name] = values.map((v) => v.toString());
      // } else if (type === "number") {
      //   data[name] = values.map((v) => Number(v));
      // } else if (type === "boolean") {
      //   data[name] = values.map((v) => Boolean(v));
      // } else {
      //   data[name] = values;
      // }
      data[column] = Array.from(values);
    }
    return data;
  }

  private callFunction(
    id: number | null,
    method: string,
    params: Record<string, unknown>,
  ) {
    const result = this.app.execute(method, params);
    return createSuccessResponse(id, result);
  }
}
