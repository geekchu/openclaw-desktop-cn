import { resolveEmbeddedSessionLane } from "./pi-embedded-runner/lanes.js";
import * as embeddedRuns from "./pi-embedded-runner/runs.js";
const abortEmbeddedPiRun = embeddedRuns.abortEmbeddedPiRun;
const isEmbeddedPiRunActive = embeddedRuns.isEmbeddedPiRunActive;
const isEmbeddedPiRunStreaming = embeddedRuns.isEmbeddedPiRunStreaming;
const queueEmbeddedPiMessage = embeddedRuns.queueEmbeddedPiMessage;
const waitForEmbeddedPiRunEnd = embeddedRuns.waitForEmbeddedPiRunEnd;
function resolveActiveEmbeddedRunSessionId(sessionKey) {
  return embeddedRuns.resolveActiveEmbeddedRunSessionId?.(sessionKey);
}
async function compactEmbeddedPiSession(...args) {
  const { compactEmbeddedPiSession: compactEmbeddedPiSession2 } = await import("./pi-embedded-runner/compact.js");
  return compactEmbeddedPiSession2(...args);
}
async function runEmbeddedPiAgent(...args) {
  const { runEmbeddedPiAgent: runEmbeddedPiAgent2 } = await import("./pi-embedded-runner/run.js");
  return runEmbeddedPiAgent2(...args);
}
export {
  abortEmbeddedPiRun,
  compactEmbeddedPiSession,
  isEmbeddedPiRunActive,
  isEmbeddedPiRunStreaming,
  queueEmbeddedPiMessage,
  resolveActiveEmbeddedRunSessionId,
  resolveEmbeddedSessionLane,
  runEmbeddedPiAgent,
  waitForEmbeddedPiRunEnd
};
