/** Create a tiny mutable runtime slot with strict access when the runtime has not been initialized. */
export function createPluginRuntimeStore(errorMessage) {
    let runtime = null;
    return {
        setRuntime(next) {
            runtime = next;
        },
        clearRuntime() {
            runtime = null;
        },
        tryGetRuntime() {
            return runtime;
        },
        getRuntime() {
            if (!runtime) {
                throw new Error(errorMessage);
            }
            return runtime;
        },
    };
}
