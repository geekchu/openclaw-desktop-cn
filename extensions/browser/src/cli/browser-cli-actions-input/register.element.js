import { danger, defaultRuntime } from "../core-api.js";
import { callBrowserAct, logBrowserActionResult, requireRef, resolveBrowserActionContext, } from "./shared.js";
export function registerBrowserElementCommands(browser, parentOpts) {
    const runElementAction = async (params) => {
        const { parent, profile } = resolveBrowserActionContext(params.cmd, parentOpts);
        try {
            const result = await callBrowserAct({
                parent,
                profile,
                body: params.body,
                timeoutMs: params.timeoutMs,
            });
            const successMessage = typeof params.successMessage === "function"
                ? params.successMessage(result)
                : params.successMessage;
            logBrowserActionResult(parent, result, successMessage);
        }
        catch (err) {
            defaultRuntime.error(danger(String(err)));
            defaultRuntime.exit(1);
        }
    };
    browser
        .command("click")
        .description("Click an element by ref from snapshot")
        .argument("<ref>", "Ref id from snapshot")
        .option("--target-id <id>", "CDP target id (or unique prefix)")
        .option("--double", "Double click", false)
        .option("--button <left|right|middle>", "Mouse button to use")
        .option("--modifiers <list>", "Comma-separated modifiers (Shift,Alt,Meta)")
        .action(async (ref, opts, cmd) => {
        const refValue = requireRef(ref);
        if (!refValue) {
            return;
        }
        const modifiers = opts.modifiers
            ? String(opts.modifiers)
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean)
            : undefined;
        await runElementAction({
            cmd,
            body: {
                kind: "click",
                ref: refValue,
                targetId: opts.targetId?.trim() || undefined,
                doubleClick: Boolean(opts.double),
                button: opts.button?.trim() || undefined,
                modifiers,
            },
            successMessage: (result) => {
                const url = result.url;
                const suffix = typeof url === "string" && url ? ` on ${url}` : "";
                return `clicked ref ${refValue}${suffix}`;
            },
        });
    });
    browser
        .command("type")
        .description("Type into an element by ref from snapshot")
        .argument("<ref>", "Ref id from snapshot")
        .argument("<text>", "Text to type")
        .option("--submit", "Press Enter after typing", false)
        .option("--slowly", "Type slowly (human-like)", false)
        .option("--target-id <id>", "CDP target id (or unique prefix)")
        .action(async (ref, text, opts, cmd) => {
        const refValue = requireRef(ref);
        if (!refValue) {
            return;
        }
        await runElementAction({
            cmd,
            body: {
                kind: "type",
                ref: refValue,
                text,
                submit: Boolean(opts.submit),
                slowly: Boolean(opts.slowly),
                targetId: opts.targetId?.trim() || undefined,
            },
            successMessage: `typed into ref ${refValue}`,
        });
    });
    browser
        .command("press")
        .description("Press a key")
        .argument("<key>", "Key to press (e.g. Enter)")
        .option("--target-id <id>", "CDP target id (or unique prefix)")
        .action(async (key, opts, cmd) => {
        await runElementAction({
            cmd,
            body: { kind: "press", key, targetId: opts.targetId?.trim() || undefined },
            successMessage: `pressed ${key}`,
        });
    });
    browser
        .command("hover")
        .description("Hover an element by ai ref")
        .argument("<ref>", "Ref id from snapshot")
        .option("--target-id <id>", "CDP target id (or unique prefix)")
        .action(async (ref, opts, cmd) => {
        await runElementAction({
            cmd,
            body: { kind: "hover", ref, targetId: opts.targetId?.trim() || undefined },
            successMessage: `hovered ref ${ref}`,
        });
    });
    browser
        .command("scrollintoview")
        .description("Scroll an element into view by ref from snapshot")
        .argument("<ref>", "Ref id from snapshot")
        .option("--target-id <id>", "CDP target id (or unique prefix)")
        .option("--timeout-ms <ms>", "How long to wait for scroll (default: 20000)", (v) => Number(v))
        .action(async (ref, opts, cmd) => {
        const refValue = requireRef(ref);
        if (!refValue) {
            return;
        }
        const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : undefined;
        await runElementAction({
            cmd,
            body: {
                kind: "scrollIntoView",
                ref: refValue,
                targetId: opts.targetId?.trim() || undefined,
                timeoutMs,
            },
            timeoutMs,
            successMessage: `scrolled into view: ${refValue}`,
        });
    });
    browser
        .command("drag")
        .description("Drag from one ref to another")
        .argument("<startRef>", "Start ref id")
        .argument("<endRef>", "End ref id")
        .option("--target-id <id>", "CDP target id (or unique prefix)")
        .action(async (startRef, endRef, opts, cmd) => {
        await runElementAction({
            cmd,
            body: {
                kind: "drag",
                startRef,
                endRef,
                targetId: opts.targetId?.trim() || undefined,
            },
            successMessage: `dragged ${startRef} → ${endRef}`,
        });
    });
    browser
        .command("select")
        .description("Select option(s) in a select element")
        .argument("<ref>", "Ref id from snapshot")
        .argument("<values...>", "Option values to select")
        .option("--target-id <id>", "CDP target id (or unique prefix)")
        .action(async (ref, values, opts, cmd) => {
        await runElementAction({
            cmd,
            body: {
                kind: "select",
                ref,
                values,
                targetId: opts.targetId?.trim() || undefined,
            },
            successMessage: `selected ${values.join(", ")}`,
        });
    });
}
