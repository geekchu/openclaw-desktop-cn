import { onAgentEvent } from "../../infra/agent-events.js";
import { onSessionTranscriptUpdate } from "../../sessions/transcript-events.js";
export function createRuntimeEvents() {
    return {
        onAgentEvent,
        onSessionTranscriptUpdate,
    };
}
