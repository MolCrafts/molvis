import { describe, expect, it } from "@rstest/core";
import { EventEmitter } from "../src/events";

interface TestEventMap {
  ping: string;
  count: number;
  data: { x: number; y: number };
}

describe("EventEmitter", () => {
  it("should call listener when event is emitted", () => {
    const emitter = new EventEmitter<TestEventMap>();
    let received = "";
    emitter.on("ping", (data) => {
      received = data;
    });
    emitter.emit("ping", "hello");
    expect(received).toBe("hello");
  });

  it("should support multiple listeners on the same event", () => {
    const emitter = new EventEmitter<TestEventMap>();
    const calls: string[] = [];
    emitter.on("ping", (d) => calls.push(`a:${d}`));
    emitter.on("ping", (d) => calls.push(`b:${d}`));
    emitter.emit("ping", "x");
    expect(calls).toEqual(["a:x", "b:x"]);
  });

  it("should not call listener after off()", () => {
    const emitter = new EventEmitter<TestEventMap>();
    let callCount = 0;
    const listener = () => {
      callCount++;
    };
    emitter.on("ping", listener);
    emitter.emit("ping", "1");
    expect(callCount).toBe(1);

    emitter.off("ping", listener);
    emitter.emit("ping", "2");
    expect(callCount).toBe(1);
  });

  it("should return unsubscribe function from on()", () => {
    const emitter = new EventEmitter<TestEventMap>();
    let callCount = 0;
    const unsub = emitter.on("ping", () => {
      callCount++;
    });
    emitter.emit("ping", "a");
    expect(callCount).toBe(1);

    unsub();
    emitter.emit("ping", "b");
    expect(callCount).toBe(1);
  });

  it("should handle double-unsubscribe gracefully", () => {
    const emitter = new EventEmitter<TestEventMap>();
    const listener = () => {};
    emitter.on("ping", listener);
    emitter.off("ping", listener);
    // Second off should not throw
    emitter.off("ping", listener);
  });

  it("should not call listeners for different events", () => {
    const emitter = new EventEmitter<TestEventMap>();
    let pingCalled = false;
    let countCalled = false;
    emitter.on("ping", () => {
      pingCalled = true;
    });
    emitter.on("count", () => {
      countCalled = true;
    });
    emitter.emit("ping", "test");
    expect(pingCalled).toBe(true);
    expect(countCalled).toBe(false);
  });

  it("should pass correct data to listener", () => {
    const emitter = new EventEmitter<TestEventMap>();
    let received: { x: number; y: number } | null = null;
    emitter.on("data", (d) => {
      received = d;
    });
    emitter.emit("data", { x: 1, y: 2 });
    expect(received).toEqual({ x: 1, y: 2 });
  });

  it("clear() should remove all listeners", () => {
    const emitter = new EventEmitter<TestEventMap>();
    let callCount = 0;
    emitter.on("ping", () => callCount++);
    emitter.on("count", () => callCount++);
    emitter.emit("ping", "a");
    emitter.emit("count", 1);
    expect(callCount).toBe(2);

    emitter.clear();
    emitter.emit("ping", "b");
    emitter.emit("count", 2);
    expect(callCount).toBe(2); // no more calls
  });

  it("should be safe to emit during listener (snapshot iteration)", () => {
    const emitter = new EventEmitter<TestEventMap>();
    const calls: string[] = [];

    emitter.on("ping", (d) => {
      calls.push(`first:${d}`);
      // Removing self during emit should not affect current iteration
      if (d === "trigger") {
        emitter.on("ping", (d2) => calls.push(`added:${d2}`));
      }
    });

    emitter.emit("ping", "trigger");
    expect(calls).toEqual(["first:trigger"]);

    // The newly added listener should fire on next emit
    emitter.emit("ping", "second");
    expect(calls).toContain("added:second");
  });

  it("should not throw when emitting event with no listeners", () => {
    const emitter = new EventEmitter<TestEventMap>();
    // Should not throw
    emitter.emit("ping", "no listeners");
  });
});
