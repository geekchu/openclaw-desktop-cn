export function isIrcControlChar(charCode) {
    return charCode <= 0x1f || charCode === 0x7f;
}
export function hasIrcControlChars(value) {
    for (const char of value) {
        if (isIrcControlChar(char.charCodeAt(0))) {
            return true;
        }
    }
    return false;
}
export function stripIrcControlChars(value) {
    let out = "";
    for (const char of value) {
        if (!isIrcControlChar(char.charCodeAt(0))) {
            out += char;
        }
    }
    return out;
}
