// Private runtime barrel for the bundled Nextcloud Talk extension.
// Keep this barrel thin and aligned with the local extension surface.

export * from "openclaw/plugin-sdk/nextcloud-talk";
export { GUARDED_FETCH_MODE } from "../../src/infra/net/fetch-guard.js";
