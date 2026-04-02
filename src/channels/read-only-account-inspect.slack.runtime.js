import { inspectSlackAccount as inspectSlackAccountImpl } from "../plugin-sdk/slack.js";
export function inspectSlackAccount(...args) {
    return inspectSlackAccountImpl(...args);
}
