import { setMatrixThreadBindingIdleTimeoutBySessionKey, setMatrixThreadBindingMaxAgeBySessionKey, } from "./runtime-matrix-boundary.js";
export function createRuntimeMatrix() {
    return {
        threadBindings: {
            setIdleTimeoutBySessionKey: setMatrixThreadBindingIdleTimeoutBySessionKey,
            setMaxAgeBySessionKey: setMatrixThreadBindingMaxAgeBySessionKey,
        },
    };
}
