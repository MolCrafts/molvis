import { describe, expect, it } from "@rstest/core";
import { yieldToUi } from "../../src/utils/yield_ui";

/** Replace one global, returning a restore thunk (handles inherited accessors). */
function stubGlobal(name: string, value: unknown): () => void {
  const own = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
  return () => {
    if (own) {
      Object.defineProperty(globalThis, name, own);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  };
}

interface RecordingPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(data: unknown): void;
  close(): void;
  readonly closeCalls: () => number;
}

interface RecordingChannel {
  readonly port1: RecordingPort;
  readonly port2: RecordingPort;
}

/** MessageChannel double: port2.postMessage delivers to port1 on a macrotask. */
function createRecordingChannelFactory(): {
  ctor: (this: unknown) => RecordingChannel;
  channels: RecordingChannel[];
} {
  const channels: RecordingChannel[] = [];
  const makePort = (): RecordingPort => {
    let closes = 0;
    const port: RecordingPort = {
      onmessage: null,
      postMessage: () => {},
      close: () => {
        closes += 1;
      },
      closeCalls: () => closes,
    };
    return port;
  };
  // Must be constructible (`new MessageChannel()`), so not an arrow function.
  const ctor = function RecordingMessageChannel(
    this: unknown,
  ): RecordingChannel {
    const port1 = makePort();
    const port2 = makePort();
    port2.postMessage = (data: unknown) => {
      setTimeout(() => port1.onmessage?.({ data }), 0);
    };
    port1.postMessage = (data: unknown) => {
      setTimeout(() => port2.onmessage?.({ data }), 0);
    };
    const channel: RecordingChannel = { port1, port2 };
    channels.push(channel);
    return channel;
  };
  return { ctor, channels };
}

describe("yieldToUi", () => {
  it("resolves on the ambient environment", async () => {
    let resolved = false;
    await yieldToUi().then(() => {
      resolved = true;
    });
    expect(resolved).toBe(true);
  });

  it("closes both MessageChannel ports when it takes the channel branch", async () => {
    const { ctor, channels } = createRecordingChannelFactory();
    // scheduler.yield exists in Chromium and wins the branch race — remove it
    // so the MessageChannel path is the one under test.
    const restoreScheduler = stubGlobal("scheduler", undefined);
    const restoreChannel = stubGlobal("MessageChannel", ctor);
    try {
      await yieldToUi();
    } finally {
      restoreChannel();
      restoreScheduler();
    }

    expect(channels.length).toBe(1);
    const channel = channels[0];
    expect(channel).toBeDefined();
    // An open port is a ref'd handle: both ends must be closed on resume.
    expect(channel?.port1.closeCalls()).toBe(1);
    expect(channel?.port2.closeCalls()).toBe(1);
  });
});
