import {
  abortActiveReplyRuns,
  abortReplyRunBySessionId,
  getActiveReplyRunCount,
  isReplyRunActiveForSessionId,
  isReplyRunStreamingForSessionId,
  listActiveReplyRunSessionIds,
  queueReplyRunMessage,
  resolveActiveReplyRunSessionId,
  waitForReplyRunEndBySessionId
} from "../../auto-reply/reply/reply-run-registry.js";
import {
  diagnosticLogger as diag,
  logMessageQueued,
  logSessionStateChange
} from "../../logging/diagnostic.js";
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
const EMBEDDED_RUN_STATE_KEY = /* @__PURE__ */ Symbol.for("openclaw.embeddedRunState");
const embeddedRunState = resolveGlobalSingleton(EMBEDDED_RUN_STATE_KEY, () => ({
  activeRuns: /* @__PURE__ */ new Map(),
  snapshots: /* @__PURE__ */ new Map(),
  sessionIdsByKey: /* @__PURE__ */ new Map(),
  waiters: /* @__PURE__ */ new Map(),
  modelSwitchRequests: /* @__PURE__ */ new Map()
}));
const ACTIVE_EMBEDDED_RUNS = embeddedRunState.activeRuns ?? (embeddedRunState.activeRuns = /* @__PURE__ */ new Map());
const ACTIVE_EMBEDDED_RUN_SNAPSHOTS = embeddedRunState.snapshots ?? (embeddedRunState.snapshots = /* @__PURE__ */ new Map());
const ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_KEY = embeddedRunState.sessionIdsByKey ?? (embeddedRunState.sessionIdsByKey = /* @__PURE__ */ new Map());
const EMBEDDED_RUN_WAITERS = embeddedRunState.waiters ?? (embeddedRunState.waiters = /* @__PURE__ */ new Map());
const EMBEDDED_RUN_MODEL_SWITCH_REQUESTS = embeddedRunState.modelSwitchRequests ?? (embeddedRunState.modelSwitchRequests = /* @__PURE__ */ new Map());
function setActiveRunSessionKey(sessionKey, sessionId) {
  const normalizedSessionKey = sessionKey?.trim();
  if (!normalizedSessionKey) {
    return;
  }
  ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_KEY.set(normalizedSessionKey, sessionId);
}
function clearActiveRunSessionKeys(sessionId, sessionKey) {
  const normalizedSessionKey = sessionKey?.trim();
  if (normalizedSessionKey) {
    if (ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_KEY.get(normalizedSessionKey) === sessionId) {
      ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_KEY.delete(normalizedSessionKey);
    }
    return;
  }
  for (const [key, activeSessionId] of ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_KEY) {
    if (activeSessionId === sessionId) {
      ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_KEY.delete(key);
    }
  }
}
function queueEmbeddedPiMessage(sessionId, text) {
  const handle = ACTIVE_EMBEDDED_RUNS.get(sessionId);
  if (!handle) {
    const queuedReplyRunMessage = queueReplyRunMessage(sessionId, text);
    if (queuedReplyRunMessage) {
      logMessageQueued({ sessionId, source: "pi-embedded-runner" });
      return true;
    }
    diag.debug(`queue message failed: sessionId=${sessionId} reason=no_active_run`);
    return false;
  }
  if (!handle.isStreaming()) {
    diag.debug(`queue message failed: sessionId=${sessionId} reason=not_streaming`);
    return false;
  }
  if (handle.isCompacting()) {
    diag.debug(`queue message failed: sessionId=${sessionId} reason=compacting`);
    return false;
  }
  logMessageQueued({ sessionId, source: "pi-embedded-runner" });
  void handle.queueMessage(text);
  return true;
}
function abortEmbeddedPiRun(sessionId, opts) {
  if (typeof sessionId === "string" && sessionId.length > 0) {
    const handle = ACTIVE_EMBEDDED_RUNS.get(sessionId);
    if (!handle) {
      if (abortReplyRunBySessionId(sessionId)) {
        return true;
      }
      diag.debug(`abort failed: sessionId=${sessionId} reason=no_active_run`);
      return false;
    }
    diag.debug(`aborting run: sessionId=${sessionId}`);
    try {
      handle.abort();
    } catch (err) {
      diag.warn(`abort failed: sessionId=${sessionId} err=${String(err)}`);
      return false;
    }
    return true;
  }
  const mode = opts?.mode;
  if (mode === "compacting") {
    let aborted = false;
    for (const [id, handle] of ACTIVE_EMBEDDED_RUNS) {
      if (!handle.isCompacting()) {
        continue;
      }
      diag.debug(`aborting compacting run: sessionId=${id}`);
      try {
        handle.abort();
        aborted = true;
      } catch (err) {
        diag.warn(`abort failed: sessionId=${id} err=${String(err)}`);
      }
    }
    return abortActiveReplyRuns({ mode }) || aborted;
  }
  if (mode === "all") {
    let aborted = false;
    for (const [id, handle] of ACTIVE_EMBEDDED_RUNS) {
      diag.debug(`aborting run: sessionId=${id}`);
      try {
        handle.abort();
        aborted = true;
      } catch (err) {
        diag.warn(`abort failed: sessionId=${id} err=${String(err)}`);
      }
    }
    return abortActiveReplyRuns({ mode }) || aborted;
  }
  return false;
}
function isEmbeddedPiRunActive(sessionId) {
  const active = ACTIVE_EMBEDDED_RUNS.has(sessionId) || isReplyRunActiveForSessionId(sessionId);
  if (active) {
    diag.debug(`run active check: sessionId=${sessionId} active=true`);
  }
  return active;
}
function isEmbeddedPiRunStreaming(sessionId) {
  const handle = ACTIVE_EMBEDDED_RUNS.get(sessionId);
  if (!handle) {
    return isReplyRunStreamingForSessionId(sessionId);
  }
  return handle.isStreaming();
}
function resolveActiveEmbeddedRunSessionId(sessionKey) {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) {
    return void 0;
  }
  return resolveActiveReplyRunSessionId(normalizedSessionKey) ?? ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_KEY.get(normalizedSessionKey);
}
function getActiveEmbeddedRunCount() {
  let activeCount = ACTIVE_EMBEDDED_RUNS.size;
  for (const sessionId of listActiveReplyRunSessionIds()) {
    if (!ACTIVE_EMBEDDED_RUNS.has(sessionId)) {
      activeCount += 1;
    }
  }
  return Math.max(activeCount, getActiveReplyRunCount());
}
function getActiveEmbeddedRunSnapshot(sessionId) {
  return ACTIVE_EMBEDDED_RUN_SNAPSHOTS.get(sessionId);
}
function requestEmbeddedRunModelSwitch(sessionId, request) {
  const normalizedSessionId = sessionId.trim();
  const provider = request.provider.trim();
  const model = request.model.trim();
  if (!normalizedSessionId || !provider || !model) {
    return false;
  }
  EMBEDDED_RUN_MODEL_SWITCH_REQUESTS.set(normalizedSessionId, {
    provider,
    model,
    authProfileId: normalizeOptionalString(request.authProfileId),
    authProfileIdSource: normalizeOptionalString(request.authProfileId) ? request.authProfileIdSource : void 0
  });
  diag.debug(
    `model switch requested: sessionId=${normalizedSessionId} provider=${provider} model=${model}`
  );
  return true;
}
function consumeEmbeddedRunModelSwitch(sessionId) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return void 0;
  }
  const request = EMBEDDED_RUN_MODEL_SWITCH_REQUESTS.get(normalizedSessionId);
  if (request) {
    EMBEDDED_RUN_MODEL_SWITCH_REQUESTS.delete(normalizedSessionId);
  }
  return request;
}
async function waitForActiveEmbeddedRuns(timeoutMs = 15e3, opts) {
  const pollMsRaw = opts?.pollMs ?? 250;
  const pollMs = Math.max(10, Math.floor(pollMsRaw));
  const maxWaitMs = Math.max(pollMs, Math.floor(timeoutMs));
  const startedAt = Date.now();
  while (true) {
    if (getActiveEmbeddedRunCount() === 0) {
      return { drained: true };
    }
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= maxWaitMs) {
      diag.warn(
        `wait for active embedded runs timed out: activeRuns=${getActiveEmbeddedRunCount()} timeoutMs=${maxWaitMs}`
      );
      return { drained: false };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
function waitForEmbeddedPiRunEnd(sessionId, timeoutMs = 15e3) {
  if (!sessionId) {
    return Promise.resolve(true);
  }
  if (!ACTIVE_EMBEDDED_RUNS.has(sessionId)) {
    return waitForReplyRunEndBySessionId(sessionId, timeoutMs);
  }
  diag.debug(`waiting for run end: sessionId=${sessionId} timeoutMs=${timeoutMs}`);
  return new Promise((resolve) => {
    const waiters = EMBEDDED_RUN_WAITERS.get(sessionId) ?? /* @__PURE__ */ new Set();
    const waiter = {
      resolve,
      timer: setTimeout(
        () => {
          waiters.delete(waiter);
          if (waiters.size === 0) {
            EMBEDDED_RUN_WAITERS.delete(sessionId);
          }
          diag.warn(`wait timeout: sessionId=${sessionId} timeoutMs=${timeoutMs}`);
          resolve(false);
        },
        Math.max(100, timeoutMs)
      )
    };
    waiters.add(waiter);
    EMBEDDED_RUN_WAITERS.set(sessionId, waiters);
    if (!ACTIVE_EMBEDDED_RUNS.has(sessionId)) {
      waiters.delete(waiter);
      if (waiters.size === 0) {
        EMBEDDED_RUN_WAITERS.delete(sessionId);
      }
      clearTimeout(waiter.timer);
      resolve(true);
    }
  });
}
function notifyEmbeddedRunEnded(sessionId) {
  const waiters = EMBEDDED_RUN_WAITERS.get(sessionId);
  if (!waiters || waiters.size === 0) {
    return;
  }
  EMBEDDED_RUN_WAITERS.delete(sessionId);
  diag.debug(`notifying waiters: sessionId=${sessionId} waiterCount=${waiters.size}`);
  for (const waiter of waiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(true);
  }
}
function setActiveEmbeddedRun(sessionId, handle, sessionKey) {
  const wasActive = ACTIVE_EMBEDDED_RUNS.has(sessionId);
  ACTIVE_EMBEDDED_RUNS.set(sessionId, handle);
  setActiveRunSessionKey(sessionKey, sessionId);
  logSessionStateChange({
    sessionId,
    sessionKey,
    state: "processing",
    reason: wasActive ? "run_replaced" : "run_started"
  });
  if (!sessionId.startsWith("probe-")) {
    diag.debug(`run registered: sessionId=${sessionId} totalActive=${ACTIVE_EMBEDDED_RUNS.size}`);
  }
}
function updateActiveEmbeddedRunSnapshot(sessionId, snapshot) {
  if (!ACTIVE_EMBEDDED_RUNS.has(sessionId)) {
    return;
  }
  ACTIVE_EMBEDDED_RUN_SNAPSHOTS.set(sessionId, snapshot);
}
function clearActiveEmbeddedRun(sessionId, handle, sessionKey) {
  if (ACTIVE_EMBEDDED_RUNS.get(sessionId) === handle) {
    ACTIVE_EMBEDDED_RUNS.delete(sessionId);
    ACTIVE_EMBEDDED_RUN_SNAPSHOTS.delete(sessionId);
    EMBEDDED_RUN_MODEL_SWITCH_REQUESTS.delete(sessionId);
    clearActiveRunSessionKeys(sessionId, sessionKey);
    logSessionStateChange({ sessionId, sessionKey, state: "idle", reason: "run_completed" });
    if (!sessionId.startsWith("probe-")) {
      diag.debug(`run cleared: sessionId=${sessionId} totalActive=${ACTIVE_EMBEDDED_RUNS.size}`);
    }
    notifyEmbeddedRunEnded(sessionId);
  } else {
    diag.debug(`run clear skipped: sessionId=${sessionId} reason=handle_mismatch`);
  }
}
const __testing = {
  resetActiveEmbeddedRuns() {
    for (const waiters of EMBEDDED_RUN_WAITERS.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(true);
      }
    }
    EMBEDDED_RUN_WAITERS.clear();
    ACTIVE_EMBEDDED_RUNS.clear();
    ACTIVE_EMBEDDED_RUN_SNAPSHOTS.clear();
    ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_KEY.clear();
    EMBEDDED_RUN_MODEL_SWITCH_REQUESTS.clear();
  }
};
export {
  __testing,
  abortEmbeddedPiRun,
  clearActiveEmbeddedRun,
  consumeEmbeddedRunModelSwitch,
  getActiveEmbeddedRunCount,
  getActiveEmbeddedRunSnapshot,
  isEmbeddedPiRunActive,
  isEmbeddedPiRunStreaming,
  queueEmbeddedPiMessage,
  requestEmbeddedRunModelSwitch,
  resolveActiveEmbeddedRunSessionId,
  setActiveEmbeddedRun,
  updateActiveEmbeddedRunSnapshot,
  waitForActiveEmbeddedRuns,
  waitForEmbeddedPiRunEnd
};
