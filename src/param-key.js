export function toSnakeCaseKey(key) {
    return key
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase();
}
export function readSnakeCaseParamRaw(params, key) {
    if (Object.hasOwn(params, key)) {
        return params[key];
    }
    const snakeKey = toSnakeCaseKey(key);
    if (snakeKey !== key && Object.hasOwn(params, snakeKey)) {
        return params[snakeKey];
    }
    return undefined;
}
