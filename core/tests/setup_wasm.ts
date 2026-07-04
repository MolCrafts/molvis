// Bundler mode: molrs ships wasm-bindgen "bundler"-target bindings, so the
// WASM module is instantiated by the bundler at import time — a bare
// side-effect import is all that's needed, no async init() to await.
import "@molcrafts/molrs";
