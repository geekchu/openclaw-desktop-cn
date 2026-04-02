import { normalizeLegacyDeliveryInput } from "../legacy-delivery.js";
export function normalizeCronCreateDeliveryInput(input) {
    const payloadRecord = input.payload && typeof input.payload === "object"
        ? { ...input.payload }
        : null;
    const deliveryRecord = input.delivery && typeof input.delivery === "object"
        ? { ...input.delivery }
        : null;
    const normalizedLegacy = normalizeLegacyDeliveryInput({
        delivery: deliveryRecord,
        payload: payloadRecord,
    });
    if (!normalizedLegacy.mutated) {
        return input;
    }
    return {
        ...input,
        payload: payloadRecord ? payloadRecord : input.payload,
        delivery: normalizedLegacy.delivery ?? input.delivery,
    };
}
export function resolveInitialCronDelivery(input) {
    if (input.delivery) {
        return input.delivery;
    }
    if (input.sessionTarget === "isolated" && input.payload.kind === "agentTurn") {
        return { mode: "announce" };
    }
    return undefined;
}
