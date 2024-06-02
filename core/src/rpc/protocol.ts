
export interface IJsonPRCRequest {
    jsonrpc: string;
    method: string;
    params: object;
    id: number;
}

export interface IJsonRPCResponse {
    jsonrpc: string;
    result: object;
    error: IJsonRPCError|null;
    id: number;
}

export interface IJsonRPCError {
    code: number;
    message: string;
    data: object;
}

const gen_id = () => {
    return Math.floor(Math.random() * 1000000);
}

export const JsonRPCRequest = (method: string, params: object) => {
    return {
        jsonrpc: "2.0",
        method: method,
        params: params,
        id: gen_id()
    }
};

export const JsonRPCResponse = (result: object, error: IJsonRPCError|null) => {
    return {
        jsonrpc: "2.0",
        result: result,
        error: error,
        id: gen_id()
    }
};

export const JsonRPCError = (code: number, message: string, data: object) => {
    return {
        code: code,
        message: message,
        data: data
    }
};