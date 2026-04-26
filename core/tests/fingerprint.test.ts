import { describe, expect, it } from "@rstest/core";
import { fingerprintFile } from "../src/io/cache/fingerprint";

function fileOf(name: string, bytes: string, lastModified: number): File {
  return new File([bytes], name, { lastModified, type: "text/plain" });
}

describe("fingerprintFile", () => {
  it("includes name, size, mtime, and format", () => {
    const f = fileOf("traj.lammpstrj", "x".repeat(100), 1700000000000);
    const fp = fingerprintFile(f, "lammps-dump");
    expect(fp).toBe("traj.lammpstrj-100-1700000000000-lammps-dump");
  });

  it("differs across formats for the same file", () => {
    const f = fileOf("data.bin", "x".repeat(1), 1);
    expect(fingerprintFile(f, "xyz")).not.toBe(fingerprintFile(f, "pdb"));
  });

  it("differs when only the size changes", () => {
    const a = fileOf("foo", "abc", 100);
    const b = fileOf("foo", "abcd", 100);
    expect(fingerprintFile(a, "xyz")).not.toBe(fingerprintFile(b, "xyz"));
  });

  it("URL-encodes name characters that aren't filesystem-safe", () => {
    const f = fileOf("with space + slash/", "", 0);
    const fp = fingerprintFile(f, "xyz");
    expect(fp).not.toContain(" ");
    expect(fp).not.toContain("/");
  });

  it("clips long filenames so the fingerprint stays bounded", () => {
    const longName = `${"a".repeat(500)}.pdb`;
    const f = fileOf(longName, "", 0);
    const fp = fingerprintFile(f, "pdb");
    // 64 chars name budget + size + mtime + format separators is short.
    expect(fp.length).toBeLessThan(120);
  });
});
