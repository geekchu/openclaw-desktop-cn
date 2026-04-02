import fs from "node:fs";
import { normalizeStoredCronJobs } from "../store-migration.js";
import { loadCronStore, saveCronStore } from "../store.js";
import { recomputeNextRuns } from "./jobs.js";
async function getFileMtimeMs(path) {
    try {
        const stats = await fs.promises.stat(path);
        return stats.mtimeMs;
    }
    catch {
        return null;
    }
}
export async function ensureLoaded(state, opts) {
    // Fast path: store is already in memory. Other callers (add, list, run, …)
    // trust the in-memory copy to avoid a stat syscall on every operation.
    if (state.store && !opts?.forceReload) {
        return;
    }
    // Force reload always re-reads the file to avoid missing cross-service
    // edits on filesystems with coarse mtime resolution.
    const fileMtimeMs = await getFileMtimeMs(state.deps.storePath);
    const loaded = await loadCronStore(state.deps.storePath);
    const jobs = (loaded.jobs ?? []);
    const { mutated } = normalizeStoredCronJobs(jobs);
    state.store = { version: 1, jobs: jobs };
    state.storeLoadedAtMs = state.deps.nowMs();
    state.storeFileMtimeMs = fileMtimeMs;
    if (!opts?.skipRecompute) {
        recomputeNextRuns(state);
    }
    if (mutated) {
        await persist(state, { skipBackup: true });
    }
}
export function warnIfDisabled(state, action) {
    if (state.deps.cronEnabled) {
        return;
    }
    if (state.warnedDisabled) {
        return;
    }
    state.warnedDisabled = true;
    state.deps.log.warn({ enabled: false, action, storePath: state.deps.storePath }, "cron: scheduler disabled; jobs will not run automatically");
}
export async function persist(state, opts) {
    if (!state.store) {
        return;
    }
    await saveCronStore(state.deps.storePath, state.store, opts);
    // Update file mtime after save to prevent immediate reload
    state.storeFileMtimeMs = await getFileMtimeMs(state.deps.storePath);
}
