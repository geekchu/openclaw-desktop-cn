import { getChannelPlugin } from "../../channels/plugins/index.js";
const DEFAULT_ADAPTER = {
    supportsComponentsV2: false,
};
export function getChannelMessageAdapter(channel) {
    const adapter = getChannelPlugin(channel)?.messaging?.buildCrossContextComponents;
    if (adapter) {
        return {
            supportsComponentsV2: true,
            buildCrossContextComponents: adapter,
        };
    }
    return DEFAULT_ADAPTER;
}
