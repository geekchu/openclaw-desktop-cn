import { acpStatefulBindingTargetDriver } from "./acp-stateful-target-driver.js";
import { registerStatefulBindingTargetDriver, unregisterStatefulBindingTargetDriver, } from "./stateful-target-drivers.js";
export function ensureStatefulTargetBuiltinsRegistered() {
    registerStatefulBindingTargetDriver(acpStatefulBindingTargetDriver);
}
export function resetStatefulTargetBuiltinsForTesting() {
    unregisterStatefulBindingTargetDriver(acpStatefulBindingTargetDriver.id);
}
