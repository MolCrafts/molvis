import { describe, expect, it } from "@rstest/core";
import { SerialQueue } from "../../src/transport/serial_queue";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SerialQueue", () => {
  it("runs a later task only after a slower earlier task finished", async () => {
    const queue = new SerialQueue(() => {});
    const log: string[] = [];
    const first = queue.run(async () => {
      await delay(20);
      log.push("draw");
    });
    const second = queue.run(async () => {
      log.push("snapshot");
    });
    await Promise.all([first, second]);
    expect(log).toEqual(["draw", "snapshot"]);
  });

  it("keeps running after a task throws, and reports the error", async () => {
    const errors: unknown[] = [];
    const queue = new SerialQueue((error) => errors.push(error));
    const log: string[] = [];
    queue.run(async () => {
      throw new Error("boom");
    });
    await queue.run(async () => {
      log.push("after");
    });
    expect(log).toEqual(["after"]);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("boom");
  });
});
