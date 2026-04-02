import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setMatrixRuntime, getRuntime: getMatrixRuntime } = createPluginRuntimeStore("Matrix runtime not initialized");
export { getMatrixRuntime, setMatrixRuntime };
