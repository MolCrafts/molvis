import { describe, expect, it } from "@rstest/core";
import { FrameRenderScheduler } from "../src/frame_render_scheduler";

describe("FrameRenderScheduler", () => {
  it("runs a single requested render", async () => {
    const calls: boolean[] = [];
    const s = new FrameRenderScheduler(async (f) => {
      calls.push(f);
    });
    s.request(false);
    await s.idle();
    expect(calls).toEqual([false]);
  });

  it("coalesces synchronous requests into one (latest-wins) and upgrades forceFull", async () => {
    const calls: boolean[] = [];
    const s = new FrameRenderScheduler(async (f) => {
      calls.push(f);
    });
    // Both arrive before the queued microtask drains: collapse to one render,
    // and the forceFull request must win.
    s.request(false);
    s.request(false);
    s.request(true);
    await s.idle();
    expect(calls).toEqual([true]);
  });

  it("does not downgrade a pending forceFull back to a fast update", async () => {
    const calls: boolean[] = [];
    const s = new FrameRenderScheduler(async (f) => {
      calls.push(f);
    });
    s.request(true);
    s.request(false);
    await s.idle();
    expect(calls).toEqual([true]);
  });

  it("runs sequential non-overlapping requests separately", async () => {
    const calls: boolean[] = [];
    const s = new FrameRenderScheduler(async (f) => {
      calls.push(f);
    });
    s.request(false);
    await s.idle();
    s.request(true);
    await s.idle();
    expect(calls).toEqual([false, true]);
  });

  it("survives a render error and keeps processing later requests", async () => {
    const calls: boolean[] = [];
    const errors: unknown[] = [];
    let failNext = true;
    const s = new FrameRenderScheduler(
      async (f) => {
        calls.push(f);
        if (failNext) {
          failNext = false;
          throw new Error("render boom");
        }
      },
      (e) => errors.push(e),
    );

    s.request(false);
    await s.idle();
    s.request(true);
    await s.idle();

    expect(calls).toEqual([false, true]);
    expect(errors).toHaveLength(1);
  });
});
