export type {
  EmbeddedPiAgentMeta,
  EmbeddedPiCompactResult,
  EmbeddedPiRunMeta,
  EmbeddedPiRunResult,
} from "./pi-embedded-runner.js";

import { resolveEmbeddedSessionLane } from "./pi-embedded-runner/lanes.js";
import * as embeddedRuns from "./pi-embedded-runner/runs.js";

type CompactEmbeddedPiSession = (
  typeof import("./pi-embedded-runner/compact.js")
)["compactEmbeddedPiSession"];
type RunEmbeddedPiAgent = (typeof import("./pi-embedded-runner/run.js"))["runEmbeddedPiAgent"];

export const abortEmbeddedPiRun = embeddedRuns.abortEmbeddedPiRun;
export const isEmbeddedPiRunActive = embeddedRuns.isEmbeddedPiRunActive;
export const isEmbeddedPiRunStreaming = embeddedRuns.isEmbeddedPiRunStreaming;
export const queueEmbeddedPiMessage = embeddedRuns.queueEmbeddedPiMessage;
export const waitForEmbeddedPiRunEnd = embeddedRuns.waitForEmbeddedPiRunEnd;
export { resolveEmbeddedSessionLane };

export function resolveActiveEmbeddedRunSessionId(sessionKey: string): string | undefined {
  return embeddedRuns.resolveActiveEmbeddedRunSessionId?.(sessionKey);
}

export async function compactEmbeddedPiSession(
  ...args: Parameters<CompactEmbeddedPiSession>
): Promise<Awaited<ReturnType<CompactEmbeddedPiSession>>> {
  const { compactEmbeddedPiSession } = await import("./pi-embedded-runner/compact.js");
  return compactEmbeddedPiSession(...args);
}

export async function runEmbeddedPiAgent(
  ...args: Parameters<RunEmbeddedPiAgent>
): Promise<Awaited<ReturnType<RunEmbeddedPiAgent>>> {
  const { runEmbeddedPiAgent } = await import("./pi-embedded-runner/run.js");
  return runEmbeddedPiAgent(...args);
}
