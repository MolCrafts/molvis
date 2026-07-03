// molrs ships wasm-bindgen "web"-target bindings: nothing is bound to the
// internal `wasm` singleton until init() instantiates the module, and that
// instantiation is async. Awaiting it at the top level blocks every importing
// test module's collection until the instance is ready, so `new Frame()` (and
// friends) in describe() bodies can't race the instantiation — the source of
// intermittent "Cannot read properties of undefined (reading 'frame_new')"
// failures. init() is idempotent (returns the existing instance), so this is a
// cheap no-op if the bundler already instantiated the module.
import init from "@molcrafts/molrs";

await init();
