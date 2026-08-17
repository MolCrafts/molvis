/**
 * Trajectory-specific OPFS caching.
 *
 * The namespace itself, the byte bucket and the sweep helpers live in
 * `@molcrafts/molvis-core/opfs` — they are browser infrastructure that
 * `sketch` needs too, and the two engines are peers that cannot import
 * each other. What stays here is the part that is genuinely stage's: the
 * `.molidx` frame-index sidecar and its codec.
 *
 * Re-exported below so stage-internal callers have one import site.
 */
export {
  clearOpfsCache,
  type Fingerprint,
  fingerprintFile,
  getFileIfExists,
  getOpfsBucket,
  getOpfsRoot,
  isNotFound,
  OPFS_BUCKETS,
  OpfsBlobCache,
  type OpfsBucket,
  type OpfsCacheUsage,
  readOpfsCacheUsage,
  removeEntryIfExists,
  safeKey,
} from "@molcrafts/molvis-core/opfs";
export {
  type CachedIndex,
  decodeMolidx,
  encodeMolidx,
  type FrameIndexLike,
} from "./molidx_codec";
export { OpfsIndexCache } from "./opfs_index_cache";
