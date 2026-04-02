import { chunkTextByBreakResolver } from "../shared/text-chunking.js";
/** Chunk outbound text while preferring newline boundaries over spaces. */
export function chunkTextForOutbound(text, limit) {
    return chunkTextByBreakResolver(text, limit, (window) => {
        const lastNewline = window.lastIndexOf("\n");
        const lastSpace = window.lastIndexOf(" ");
        return lastNewline > 0 ? lastNewline : lastSpace;
    });
}
