import { reduceInteractiveReply } from "openclaw/plugin-sdk/interactive-runtime";
import { normalizeInteractiveReply, } from "openclaw/plugin-sdk/interactive-runtime";
const TELEGRAM_INTERACTIVE_ROW_SIZE = 3;
function toTelegramButtonStyle(style) {
    return style === "danger" || style === "success" || style === "primary" ? style : undefined;
}
function chunkInteractiveButtons(buttons, rows) {
    for (let i = 0; i < buttons.length; i += TELEGRAM_INTERACTIVE_ROW_SIZE) {
        const row = buttons.slice(i, i + TELEGRAM_INTERACTIVE_ROW_SIZE).map((button) => ({
            text: button.label,
            callback_data: button.value,
            style: toTelegramButtonStyle(button.style),
        }));
        if (row.length > 0) {
            rows.push(row);
        }
    }
}
export function buildTelegramInteractiveButtons(interactive) {
    const rows = reduceInteractiveReply(interactive, [], (state, block) => {
        if (block.type === "buttons") {
            chunkInteractiveButtons(block.buttons, state);
            return state;
        }
        if (block.type === "select") {
            chunkInteractiveButtons(block.options.map((option) => ({
                label: option.label,
                value: option.value,
            })), state);
        }
        return state;
    });
    return rows.length > 0 ? rows : undefined;
}
export function resolveTelegramInlineButtons(params) {
    return (params.buttons ?? buildTelegramInteractiveButtons(normalizeInteractiveReply(params.interactive)));
}
