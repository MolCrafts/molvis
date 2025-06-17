import type { AnyModel } from "@anywidget/types";

interface WidgetModel {
  width: number;
  height: number;
  session_id: number;
}
type ModelType = AnyModel;  // AnyModel<WidgetModel>

interface JsonRPCRequest {
  jsonrpc: "2.0";
  id: number | null;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRPCResponse {
  jsonrpc: "2.0";
  id: number;
  result: unknown | null;
  error: {
    code: number;
    message: string;
    data: { [key: string]: string } | null;
  } | null;
}

const createSuccessResponse = (id: number | null, result: unknown) => {
  if (id === null) return undefined;
  return {
    jsonrpc: "2.0",
    id,
    result,
    error: null
  };
}

const createErrorResponse = (id: number | null, code: number, message: string) => {
  if (id === null) return undefined;
  return {
    jsonrpc: "2.0",
    id,
    result: null,
    error: { code, message, data: null }
  };
}

export type { ModelType, JsonRPCRequest, JsonRPCResponse, WidgetModel};
export { createSuccessResponse, createErrorResponse };