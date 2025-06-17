import { JsonRpcHandler } from "../jsonrpc";
import * as Arrow from "@apache-arrow/ts";

// Mock Molvis app interface
interface MockMolvisInterface {
  execute(method: string, params: Record<string, unknown>): unknown;
}

// Mock Molvis app
class MockMolvis implements MockMolvisInterface {
  public executedCommands: Array<{ method: string; params: Record<string, unknown> }> = [];

  execute(method: string, params: Record<string, unknown>) {
    this.executedCommands.push({ method, params });
    return { success: true, method, params };
  }
}

describe("JsonRpcHandler", () => {
  let handler: JsonRpcHandler;
  let mockApp: MockMolvis;

  beforeEach(() => {
    mockApp = new MockMolvis();
    handler = new JsonRpcHandler(mockApp as MockMolvisInterface);
  });

  test("should handle simple commands without buffers", () => {
    const request = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "draw_atom",
      params: { name: "C", x: 0, y: 0, z: 0 }
    };

    const response = handler.execute(request);

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { success: true, method: "draw_atom", params: request.params },
      error: null
    });
    expect(mockApp.executedCommands).toHaveLength(1);
    expect(mockApp.executedCommands[0].method).toBe("draw_atom");
  });

  test("should handle invalid JSON-RPC version", () => {
    const request = {
      jsonrpc: "1.0" as "2.0",
      id: 1,
      method: "test",
      params: {}
    };

    const response = handler.execute(request);

    expect(response).toBeDefined();
    expect(response?.error).toBeTruthy();
    expect(response?.error?.code).toBe(-32600);
  });

  test("should handle commands with arrow buffers", () => {
    // Create a simple arrow table for testing
    const data = {
      x: [1, 2, 3],
      y: [4, 5, 6],
      name: ["A", "B", "C"]
    };

    const table = Arrow.tableFromArrays(data);
    const buffer = Arrow.tableToIPC(table);
    const dataView = new DataView(buffer.buffer);

    const request = {
      jsonrpc: "2.0" as const,
      id: 2,
      method: "draw_frame",
      params: {
        atoms: "__buffer.0",
        bonds: null,
        options: {}
      }
    };

    const response = handler.execute(request, [dataView]);

    expect(response).toBeDefined();
    expect(response?.error).toBeNull();
    expect(mockApp.executedCommands).toHaveLength(1);
    
    const executedParams = mockApp.executedCommands[0].params;
    expect(executedParams.atoms).toBeTruthy();
    expect(executedParams.atoms).toEqual({
      x: [1, 2, 3],
      y: [4, 5, 6],
      name: ["A", "B", "C"]
    });
  });

  test("should handle errors gracefully", () => {
    const mockAppWithError: MockMolvisInterface = {
      execute: () => {
        throw new Error("Test error");
      }
    };

    const handlerWithError = new JsonRpcHandler(mockAppWithError);
    
    const request = {
      jsonrpc: "2.0" as const,
      id: 3,
      method: "failing_method",
      params: {}
    };

    const response = handlerWithError.execute(request);

    expect(response).toBeDefined();
    expect(response?.error).toBeTruthy();
    expect(response?.error?.code).toBe(-32603);
    expect(response?.error?.message).toContain("Test error");
  });

  test("should handle missing buffers", () => {
    const request = {
      jsonrpc: "2.0" as const,
      id: 4,
      method: "draw_frame",
      params: {
        atoms: "__buffer.0",
        bonds: "__buffer.1"
      }
    };

    // Provide no buffers - should throw error
    expect(() => {
      handler.execute(request, []);
    }).toThrow();
  });
});
