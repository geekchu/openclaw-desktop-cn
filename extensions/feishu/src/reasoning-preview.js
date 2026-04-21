import { loadSessionStore, resolveSessionStoreEntry } from "../runtime-api.js";
export function resolveFeishuReasoningPreviewEnabled(params) {
  if (!params.sessionKey) {
    return false;
  }
  try {
    const store = loadSessionStore(params.storePath, { skipCache: true });
    return (
      resolveSessionStoreEntry({ store, sessionKey: params.sessionKey }).existing
        ?.reasoningLevel === "stream"
    );
  } catch {
    return false;
  }
}
