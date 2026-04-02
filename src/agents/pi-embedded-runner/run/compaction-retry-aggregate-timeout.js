/**
 * Wait for compaction retry completion with an aggregate timeout to avoid
 * holding a session lane indefinitely when retry resolution is lost.
 */
export async function waitForCompactionRetryWithAggregateTimeout(params) {
    const timeoutMsRaw = params.aggregateTimeoutMs;
    const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(1, Math.floor(timeoutMsRaw)) : 1;
    let timedOut = false;
    const waitPromise = params.waitForCompactionRetry().then(() => "done");
    while (true) {
        let timer;
        try {
            const result = await params.abortable(Promise.race([
                waitPromise,
                new Promise((resolve) => {
                    timer = setTimeout(() => resolve("timeout"), timeoutMs);
                }),
            ]));
            if (result === "done") {
                break;
            }
            // Keep extending the timeout window while compaction is actively running.
            // We only trigger the fallback timeout once compaction appears idle.
            if (params.isCompactionStillInFlight?.()) {
                continue;
            }
            timedOut = true;
            params.onTimeout?.();
            break;
        }
        finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        }
    }
    return { timedOut };
}
