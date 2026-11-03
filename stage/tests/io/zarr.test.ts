import { type Frame, MrecReader } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { viewAtomCoords } from "../../src/io/atom_coords";
import {
  collectMrecDirectory,
  isMrecDirectorySource,
  loadMrecDirectory,
  loadMrecFiles,
  loadMrecInput,
  loadMrecStore,
  loadMrecZip,
  MREC_FRAME_CACHE_SIZE,
  type MrecDirectorySource,
  type MrecDirent,
  MrecFrameCache,
  type MrecStoreInput,
} from "../../src/io/zarr";
import { buildStoredZip } from "./fixtures/stored_zip";
import { TINY_ZARR_FILES } from "./fixtures/tiny_zarr_files";
import "../setup_wasm";

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function memoryMrecSource(files: Record<string, string>): MrecDirectorySource {
  const bytes = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(files)) {
    bytes.set(path, decodeBase64(content));
  }

  return {
    list: async (path) => {
      const prefix = path ? `${path}/` : "";
      const names = new Map<string, MrecDirent["kind"]>();
      for (const key of bytes.keys()) {
        if (prefix) {
          if (key === path || !key.startsWith(prefix)) continue;
        }
        const rest = prefix ? key.slice(prefix.length) : key;
        const slash = rest.indexOf("/");
        const name = slash < 0 ? rest : rest.slice(0, slash);
        const kind: MrecDirent["kind"] = slash < 0 ? "file" : "directory";
        if (names.get(name) === "directory") continue;
        names.set(name, kind);
      }
      return [...names.entries()].map(([name, kind]) => ({ name, kind }));
    },
    read: async (path) => {
      const content = bytes.get(path);
      if (!content) throw new Error(`missing ${path}`);
      return content;
    },
  };
}

describe("collectMrecDirectory", () => {
  it("walks a directory source into store-relative keys", async () => {
    const source = memoryMrecSource({
      "zarr.json": btoa("root"),
      "trajectory/zarr.json": btoa("traj"),
      "trajectory/step/c/0": btoa("chunk"),
    });
    const files = await collectMrecDirectory(source);
    expect([...files.keys()].sort()).toEqual([
      "trajectory/step/c/0",
      "trajectory/zarr.json",
      "zarr.json",
    ]);
    expect(new TextDecoder().decode(files.get("zarr.json"))).toBe("root");
  });

  it("strips a nested root prefix from keys", async () => {
    const source = memoryMrecSource({
      "artifacts/pkg/zarr.json": btoa("root"),
      "artifacts/pkg/meta/zarr.json": btoa("meta"),
    });
    const files = await collectMrecDirectory(source, "artifacts/pkg");
    expect([...files.keys()].sort()).toEqual(["meta/zarr.json", "zarr.json"]);
  });

  it("refuses an empty store", async () => {
    const source = memoryMrecSource({});
    await expect(collectMrecDirectory(source)).rejects.toThrow(
      "mrec store is empty",
    );
  });
});

describe("loadMrecStore", () => {
  it("constructs MrecReader (not RecordReader)", () => {
    const files = new Map<string, Uint8Array>();
    for (const [path, content] of Object.entries(TINY_ZARR_FILES)) {
      files.set(path, decodeBase64(content));
    }

    const originalNFrames = MrecReader.prototype.nFrames;
    let counts = 0;
    MrecReader.prototype.nFrames = function (this: MrecReader): number {
      counts += 1;
      return originalNFrames.call(this);
    };

    try {
      const bundle = loadMrecStore(files);
      try {
        expect(counts).toBeGreaterThan(0);
      } finally {
        bundle.dispose();
      }
    } finally {
      MrecReader.prototype.nFrames = originalNFrames;
    }
  });
});

describe("MrecFrameCache", () => {
  const frame = (tag: number) => ({ tag }) as unknown as Frame;

  it("defaults to the configurable bound", () => {
    expect(new MrecFrameCache().capacity).toBe(MREC_FRAME_CACHE_SIZE);
    expect(() => new MrecFrameCache(0)).toThrow(/>= 1/);
  });

  it("promotes on hit so a recently read frame survives eviction", () => {
    const cache = new MrecFrameCache(2);
    cache.set(0, frame(0));
    cache.set(1, frame(1));
    expect(cache.get(0)).toBe(cache.get(0)); // hit → 0 is now most recent
    cache.set(2, frame(2)); // evicts 1, not 0
    expect(cache.has(0)).toBe(true);
    expect(cache.has(1)).toBe(false);
    expect(cache.has(2)).toBe(true);
    expect(cache.size).toBe(2);
  });

  it("drain hands back every frame and empties the cache", () => {
    const cache = new MrecFrameCache(4);
    cache.set(3, frame(3));
    cache.set(4, frame(4));
    expect(
      cache.drain().map((f) => (f as unknown as { tag: number }).tag),
    ).toEqual([3, 4]);
    expect(cache.size).toBe(0);
  });
});

describe("mrec provider readahead", () => {
  function tinyStore(): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    for (const [path, content] of Object.entries(TINY_ZARR_FILES)) {
      files.set(path, decodeBase64(content));
    }
    return files;
  }

  /** Spy on frame decodes; returns the index log and a restore hook. */
  function spyReadFrame(): { reads: number[]; restore: () => void } {
    const original = MrecReader.prototype.readFrame;
    const reads: number[] = [];
    MrecReader.prototype.readFrame = function (
      this: MrecReader,
      index: number,
    ) {
      reads.push(index);
      return original.call(this, index);
    };
    return {
      reads,
      restore: () => {
        MrecReader.prototype.readFrame = original;
      },
    };
  }

  it("decodes the next frame during idle time and serves it from cache", () => {
    const idle: Array<() => void> = [];
    const spy = spyReadFrame();
    const bundle = loadMrecStore(tinyStore(), {
      scheduleIdle: (task) => idle.push(task),
    });
    try {
      const first = bundle.trajectory.get(0);
      expect(spy.reads).toEqual([0]);
      expect(idle).toHaveLength(1);

      idle.shift()?.();
      expect(spy.reads).toEqual([0, 1]);

      const second = bundle.trajectory.get(1);
      expect(spy.reads).toEqual([0, 1]); // cache hit, no second decode
      expect(second).not.toBe(first);
      // Serving the last frame schedules nothing past the end.
      expect(idle).toHaveLength(0);
    } finally {
      spy.restore();
      bundle.dispose();
    }
  });

  it("does not touch a disposed reader from a late idle callback", () => {
    const idle: Array<() => void> = [];
    const spy = spyReadFrame();
    const bundle = loadMrecStore(tinyStore(), {
      scheduleIdle: (task) => idle.push(task),
    });
    try {
      bundle.trajectory.get(0);
      bundle.dispose();
      expect(() => idle.shift()?.()).not.toThrow();
      expect(spy.reads).toEqual([0]);
    } finally {
      spy.restore();
    }
  });
});

describe("loadMrecFiles / loadMrecDirectory", () => {
  it("opens a two-frame molrec trajectory through MrecReader", () => {
    const bundle = loadMrecFiles(TINY_ZARR_FILES);
    try {
      expect(bundle.trajectory.length).toBe(2);
      const first = viewAtomCoords(bundle.trajectory.get(0)!.get("atoms"));
      const second = viewAtomCoords(bundle.trajectory.get(1)!.get("atoms"));
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(Array.from(first!.x)).toEqual([0, 1]);
      expect(Array.from(second!.x)).toEqual([2, 3]);
      expect(bundle.trajectory.get(0)!.get("atoms").nRows).toBe(2);
    } finally {
      bundle.dispose();
    }
  });

  it("accepts raw bytes and base64 text side by side", () => {
    const entries = Object.entries(TINY_ZARR_FILES);
    const mixed: Record<string, Uint8Array | string> = {};
    entries.forEach(([path, content], i) => {
      mixed[path] = i % 2 === 0 ? decodeBase64(content) : content;
    });
    const bundle = loadMrecFiles(mixed);
    try {
      expect(bundle.trajectory.length).toBe(2);
      expect([
        ...(bundle.trajectory.get(1)!.get("atoms").copy("element") as string[]),
      ]).toEqual(["H", "He"]);
    } finally {
      bundle.dispose();
    }
  });

  it("opens the same store from a directory source", async () => {
    const bundle = await loadMrecDirectory(memoryMrecSource(TINY_ZARR_FILES));
    try {
      expect(bundle.trajectory.length).toBe(2);
      const atoms = bundle.trajectory.get(0)!.get("atoms");
      expect([...(atoms.copy("element") as string[])]).toEqual(["H", "He"]);
    } finally {
      bundle.dispose();
    }
  });
});

describe("loadMrecZip / loadMrecInput", () => {
  function tinyFiles(): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    for (const [path, content] of Object.entries(TINY_ZARR_FILES)) {
      files.set(path, decodeBase64(content));
    }
    return files;
  }

  it("opens a packed store through MrecReader.fromZip", () => {
    const bundle = loadMrecZip(buildStoredZip(tinyFiles()));
    try {
      expect(bundle.trajectory.length).toBe(2);
      expect([
        ...(bundle.trajectory.get(1)!.get("atoms").copy("element") as string[]),
      ]).toEqual(["H", "He"]);
    } finally {
      bundle.dispose();
    }
  });

  it("refuses an empty archive", () => {
    expect(() => loadMrecZip(new Uint8Array(0))).toThrow(/empty/);
  });

  it("opens every MrecStoreInput shape on the sync provider", async () => {
    const files = tinyFiles();
    const tree = new Map<string, File>();
    for (const [key, data] of files) {
      tree.set(key, new File([data as BlobPart], key.split("/").pop() ?? key));
    }
    const inputs: MrecStoreInput[] = [
      { kind: "files", files },
      { kind: "file-tree", files: tree },
      { kind: "zip", blob: new Blob([buildStoredZip(files) as BlobPart]) },
    ];
    for (const input of inputs) {
      const bundle = await loadMrecInput(input);
      try {
        expect(bundle.trajectory.length).toBe(2);
        expect(bundle.trajectory.get(0)!.get("atoms").nRows).toBe(2);
      } finally {
        bundle.dispose();
      }
    }
  });

  it("isMrecDirectorySource tells the async host apart from store inputs", () => {
    expect(isMrecDirectorySource(memoryMrecSource({}))).toBe(true);
    expect(isMrecDirectorySource({ kind: "files", files: tinyFiles() })).toBe(
      false,
    );
  });
});

describe("mrec sync provider section updates", () => {
  it("exposes per-block update ids that differ when the rows differ", () => {
    const bundle = loadMrecFiles(TINY_ZARR_FILES);
    try {
      const first = bundle.trajectory.sectionUpdates(0);
      const second = bundle.trajectory.sectionUpdates(1);
      expect(first?.has("atoms")).toBe(true);
      expect(second?.has("atoms")).toBe(true);
      // Frame 1 moved every atom: a new atoms update.
      expect(first?.get("atoms")).not.toBe(second?.get("atoms"));
      expect(bundle.trajectory.sectionUpdates(2)).toBeUndefined();
    } finally {
      bundle.dispose();
    }
  });

  it("goes dark once the reader is disposed", () => {
    const bundle = loadMrecFiles(TINY_ZARR_FILES);
    const trajectory = bundle.trajectory;
    bundle.dispose();
    expect(trajectory.sectionUpdates(0)).toBeUndefined();
  });
});
