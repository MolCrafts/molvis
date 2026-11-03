/**
 * Public surface of the trajectory worker transport: the main-thread
 * `TrajectoryRuntime` (a workload-channel client), the frame codec
 * (`rehydrateFrame` / `frameMessageTransferList`), and the typed
 * job/result/progress/host-call parameters from `./protocol`.
 *
 * The hand-rolled wire-envelope types (`OpenRequest`, `BytesResponse`,
 * `WorkerHeartbeat`, …) died with the wire protocol — a deliberate
 * breaking change on the `./trajectory-protocol` subpath (spec
 * worker-arch-unify-02-runtime); envelopes now live in `core/workload`.
 */

export { encodeFrame, rehydrateFrame } from "./frame_codec";
export type {
  BlockPayload,
  BoxPayload,
  ColumnPayload,
  Format,
  FrameMessage,
  MrecFilesSourceHandle,
  MrecFileTreeSourceHandle,
  MrecSourceHandle,
  MrecZipSourceHandle,
  RequestBytes,
  SourceHandle,
  StreamFormat,
  TrajectoryIndexProgress,
  TrajectoryJob,
  TrajectoryJobResult,
} from "./protocol";
export {
  frameMessageTransferList,
  isMrecSourceHandle,
  mrecSourceTransferList,
} from "./protocol";
export {
  CancellationError,
  type IndexProgressCallback,
  type OpenOptions,
  type OpenResult,
  SECTION_UPDATE_LOG_CAPACITY,
  TrajectoryRuntime,
  type WorkerLike,
} from "./runtime";
