// @molcrafts/molvis-core/molrs is --target bundler only. Do not add wasm-bindgen web-target
// startup (`import init ...; await init()`): bundler output imports the WASM
// module and runs `__wbindgen_start()` during module evaluation. Test files
// that need molrs import this module first.
import "@molcrafts/molvis-core/molrs";
