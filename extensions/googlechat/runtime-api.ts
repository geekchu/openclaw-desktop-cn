// Private runtime barrel for the bundled Google Chat extension.
// Keep this barrel thin and aligned with the local extension surface.

export * from "openclaw/plugin-sdk/googlechat";
export { GUARDED_FETCH_MODE } from "../../src/infra/net/fetch-guard.js";
