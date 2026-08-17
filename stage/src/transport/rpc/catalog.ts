/**
 * Single source of truth for JSON-RPC method names exposed by
 * {@link RPCRouter}. Python `FrontendCommands` and any host tooling
 * must stay aligned with this list (see `rpc.list_methods`).
 *
 * Versioning is semver over the method set: bump **major** when removing or
 * renaming a method, **minor** when adding one. A host that only needs to know
 * whether some method exists should ask `rpc.list_methods` rather than compare
 * versions — the version answers "will my existing calls still work", the
 * catalog answers "can I make this new call".
 */
export const RPC_PROTOCOL_VERSION = "1.5.0";

/** Ordered catalog of methods the core router implements. */
export const RPC_METHODS = [
  "scene.new_frame",
  "scene.draw_frame",
  "scene.draw_atom",
  "scene.draw_bond",
  "scene.draw_box",
  "scene.commit",
  "scene.clear",
  "scene.export_frame",
  "scene.set_trajectory",
  "scene.append_frame",
  "scene.set_frame_labels",
  "scene.seek_frame",
  "scene.apply_state",
  "scene.add_data_source",
  "scene.remove_data_source",
  "scene.list_data_sources",
  "selection.get",
  "selection.select_atoms",
  "selection.clear",
  "selection.select_by_expression",
  "pipeline.list",
  "pipeline.available_modifiers",
  "pipeline.add_modifier",
  "pipeline.remove_modifier",
  "pipeline.reorder_modifier",
  "pipeline.set_enabled",
  "pipeline.set_selection_scope",
  "pipeline.set_source_owner",
  "pipeline.clear",
  "snapshot.take",
  "overlay.mark_atom",
  "overlay.unmark_atom",
  "view.set_style",
  "view.set_theme",
  "view.set_mode",
  "camera.get_pose",
  "camera.set_pose",
  "camera.look_at",
  "camera.fit",
  "camera.reset",
  "camera.track",
  "camera.stop_track",
  "state.get",
  "rpc.list_methods",
] as const;

export type RpcMethodName = (typeof RPC_METHODS)[number];

const METHOD_SET = new Set<string>(RPC_METHODS);

export function isRpcMethodName(method: string): method is RpcMethodName {
  return METHOD_SET.has(method);
}

export function listRpcMethods(): {
  version: string;
  methods: readonly string[];
} {
  return {
    version: RPC_PROTOCOL_VERSION,
    methods: RPC_METHODS,
  };
}
