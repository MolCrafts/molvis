import packageManifest from "../package.json" with { type: "json" };

type PackageWithVersion = { version?: string };

const version = (packageManifest as PackageWithVersion).version;

export const MOLVIS_VERSION =
  typeof version === "string" && version.length > 0 ? version : "0.0.0";
