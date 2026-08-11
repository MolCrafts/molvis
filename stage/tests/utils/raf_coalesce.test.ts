import { describe, expect, it } from "@rstest/core";
import { createRafCoalesce } from "../../src/utils/raf_coalesce";

describe("createRafCoalesce", () => {
  it("runs at most once per schedule batch when many schedule calls fire", () => {
    const queue: Array<() => void> = [];
    let calls = 0;
    const c = createRafCoalesce(
      () => {
        calls += 1;
      },
      (cb) => {
        queue.push(() => cb(0));
        return queue.length;
      },
      (id) => {
        queue[id - 1] = () => {};
      },
    );

    c.schedule();
    c.schedule();
    c.schedule();
    expect(calls).toBe(0);
    expect(c.pending).toBe(true);
    expect(queue.length).toBe(1);

    queue[0]?.();
    expect(calls).toBe(1);
    expect(c.pending).toBe(false);
  });

  it("flush runs immediately and cancels a pending frame", () => {
    const queue: Array<() => void> = [];
    let calls = 0;
    const c = createRafCoalesce(
      () => {
        calls += 1;
      },
      (cb) => {
        queue.push(() => cb(0));
        return queue.length;
      },
      (id) => {
        queue[id - 1] = () => {};
      },
    );

    c.schedule();
    c.flush();
    expect(calls).toBe(1);
    expect(c.pending).toBe(false);
    // Stale frame must not double-fire.
    queue[0]?.();
    expect(calls).toBe(1);
  });

  it("cancel drops work without running", () => {
    const queue: Array<() => void> = [];
    let calls = 0;
    const c = createRafCoalesce(
      () => {
        calls += 1;
      },
      (cb) => {
        queue.push(() => cb(0));
        return queue.length;
      },
      (id) => {
        queue[id - 1] = () => {};
      },
    );
    c.schedule();
    c.cancel();
    expect(c.pending).toBe(false);
    queue[0]?.();
    expect(calls).toBe(0);
  });
});
