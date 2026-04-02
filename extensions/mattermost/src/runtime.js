import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setMattermostRuntime, getRuntime: getMattermostRuntime } = createPluginRuntimeStore("Mattermost runtime not initialized");
export { getMattermostRuntime, setMattermostRuntime };
