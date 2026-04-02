/**
 * Matrix Poll Types (MSC3381)
 *
 * Defines types for Matrix poll events:
 * - m.poll.start - Creates a new poll
 * - m.poll.response - Records a vote
 * - m.poll.end - Closes a poll
 */
import { normalizePollInput } from "../runtime-api.js";
export const M_POLL_START = "m.poll.start";
export const M_POLL_RESPONSE = "m.poll.response";
export const M_POLL_END = "m.poll.end";
export const ORG_POLL_START = "org.matrix.msc3381.poll.start";
export const ORG_POLL_RESPONSE = "org.matrix.msc3381.poll.response";
export const ORG_POLL_END = "org.matrix.msc3381.poll.end";
export const POLL_EVENT_TYPES = [
    M_POLL_START,
    M_POLL_RESPONSE,
    M_POLL_END,
    ORG_POLL_START,
    ORG_POLL_RESPONSE,
    ORG_POLL_END,
];
export const POLL_START_TYPES = [M_POLL_START, ORG_POLL_START];
export const POLL_RESPONSE_TYPES = [M_POLL_RESPONSE, ORG_POLL_RESPONSE];
export const POLL_END_TYPES = [M_POLL_END, ORG_POLL_END];
export function isPollStartType(eventType) {
    return POLL_START_TYPES.includes(eventType);
}
export function isPollResponseType(eventType) {
    return POLL_RESPONSE_TYPES.includes(eventType);
}
export function isPollEndType(eventType) {
    return POLL_END_TYPES.includes(eventType);
}
export function isPollEventType(eventType) {
    return POLL_EVENT_TYPES.includes(eventType);
}
export function getTextContent(text) {
    if (!text) {
        return "";
    }
    return text["m.text"] ?? text["org.matrix.msc1767.text"] ?? text.body ?? "";
}
export function parsePollStart(content) {
    const poll = content[M_POLL_START] ??
        content[ORG_POLL_START] ??
        content["m.poll"];
    if (!poll) {
        return null;
    }
    const question = getTextContent(poll.question).trim();
    if (!question) {
        return null;
    }
    const answers = poll.answers
        .map((answer) => ({
        id: answer.id,
        text: getTextContent(answer).trim(),
    }))
        .filter((answer) => answer.id.trim().length > 0 && answer.text.length > 0);
    if (answers.length === 0) {
        return null;
    }
    const maxSelectionsRaw = poll.max_selections;
    const maxSelections = typeof maxSelectionsRaw === "number" && Number.isFinite(maxSelectionsRaw)
        ? Math.floor(maxSelectionsRaw)
        : 1;
    return {
        question,
        answers,
        kind: poll.kind ?? "m.poll.disclosed",
        maxSelections: Math.min(Math.max(maxSelections, 1), answers.length),
    };
}
export function parsePollStartContent(content) {
    const parsed = parsePollStart(content);
    if (!parsed) {
        return null;
    }
    return {
        eventId: "",
        roomId: "",
        sender: "",
        senderName: "",
        question: parsed.question,
        answers: parsed.answers.map((answer) => answer.text),
        kind: parsed.kind,
        maxSelections: parsed.maxSelections,
    };
}
export function formatPollAsText(summary) {
    const lines = [
        "[Poll]",
        summary.question,
        "",
        ...summary.answers.map((answer, idx) => `${idx + 1}. ${answer}`),
    ];
    return lines.join("\n");
}
export function resolvePollReferenceEventId(content) {
    if (!content || typeof content !== "object") {
        return null;
    }
    const relates = content["m.relates_to"];
    if (!relates || typeof relates.event_id !== "string") {
        return null;
    }
    const eventId = relates.event_id.trim();
    return eventId.length > 0 ? eventId : null;
}
export function parsePollResponseAnswerIds(content) {
    if (!content || typeof content !== "object") {
        return null;
    }
    const response = content[M_POLL_RESPONSE] ??
        content[ORG_POLL_RESPONSE];
    if (!response || !Array.isArray(response.answers)) {
        return null;
    }
    return response.answers.filter((answer) => typeof answer === "string");
}
export function buildPollResultsSummary(params) {
    const parsed = parsePollStart(params.content);
    if (!parsed) {
        return null;
    }
    let pollClosedAt = Number.POSITIVE_INFINITY;
    for (const event of params.relationEvents) {
        if (event.unsigned?.redacted_because) {
            continue;
        }
        if (!isPollEndType(typeof event.type === "string" ? event.type : "")) {
            continue;
        }
        if (event.sender !== params.sender) {
            continue;
        }
        const ts = typeof event.origin_server_ts === "number" && Number.isFinite(event.origin_server_ts)
            ? event.origin_server_ts
            : Number.POSITIVE_INFINITY;
        if (ts < pollClosedAt) {
            pollClosedAt = ts;
        }
    }
    const answerIds = new Set(parsed.answers.map((answer) => answer.id));
    const latestVoteBySender = new Map();
    const orderedRelationEvents = [...params.relationEvents].sort((left, right) => {
        const leftTs = typeof left.origin_server_ts === "number" && Number.isFinite(left.origin_server_ts)
            ? left.origin_server_ts
            : Number.POSITIVE_INFINITY;
        const rightTs = typeof right.origin_server_ts === "number" && Number.isFinite(right.origin_server_ts)
            ? right.origin_server_ts
            : Number.POSITIVE_INFINITY;
        if (leftTs !== rightTs) {
            return leftTs - rightTs;
        }
        return (left.event_id ?? "").localeCompare(right.event_id ?? "");
    });
    for (const event of orderedRelationEvents) {
        if (event.unsigned?.redacted_because) {
            continue;
        }
        if (!isPollResponseType(typeof event.type === "string" ? event.type : "")) {
            continue;
        }
        const senderId = typeof event.sender === "string" ? event.sender.trim() : "";
        if (!senderId) {
            continue;
        }
        const eventTs = typeof event.origin_server_ts === "number" && Number.isFinite(event.origin_server_ts)
            ? event.origin_server_ts
            : Number.POSITIVE_INFINITY;
        if (eventTs > pollClosedAt) {
            continue;
        }
        const rawAnswers = parsePollResponseAnswerIds(event.content) ?? [];
        const normalizedAnswers = Array.from(new Set(rawAnswers
            .map((answerId) => answerId.trim())
            .filter((answerId) => answerIds.has(answerId))
            .slice(0, parsed.maxSelections)));
        latestVoteBySender.set(senderId, {
            ts: eventTs,
            eventId: typeof event.event_id === "string" ? event.event_id : "",
            answerIds: normalizedAnswers,
        });
    }
    const voteCounts = new Map(parsed.answers.map((answer) => [answer.id, 0]));
    let totalVotes = 0;
    for (const latestVote of latestVoteBySender.values()) {
        if (latestVote.answerIds.length === 0) {
            continue;
        }
        totalVotes += 1;
        for (const answerId of latestVote.answerIds) {
            voteCounts.set(answerId, (voteCounts.get(answerId) ?? 0) + 1);
        }
    }
    return {
        eventId: params.pollEventId,
        roomId: params.roomId,
        sender: params.sender,
        senderName: params.senderName,
        question: parsed.question,
        answers: parsed.answers.map((answer) => answer.text),
        kind: parsed.kind,
        maxSelections: parsed.maxSelections,
        entries: parsed.answers.map((answer) => ({
            id: answer.id,
            text: answer.text,
            votes: voteCounts.get(answer.id) ?? 0,
        })),
        totalVotes,
        closed: Number.isFinite(pollClosedAt),
    };
}
export function formatPollResultsAsText(summary) {
    const lines = [summary.closed ? "[Poll closed]" : "[Poll]", summary.question, ""];
    const revealResults = summary.kind === "m.poll.disclosed" || summary.closed;
    for (const [index, entry] of summary.entries.entries()) {
        if (!revealResults) {
            lines.push(`${index + 1}. ${entry.text}`);
            continue;
        }
        lines.push(`${index + 1}. ${entry.text} (${entry.votes} vote${entry.votes === 1 ? "" : "s"})`);
    }
    lines.push("");
    if (!revealResults) {
        lines.push("Responses are hidden until the poll closes.");
    }
    else {
        lines.push(`Total voters: ${summary.totalVotes}`);
    }
    return lines.join("\n");
}
function buildTextContent(body) {
    return {
        "m.text": body,
        "org.matrix.msc1767.text": body,
    };
}
function buildPollFallbackText(question, answers) {
    if (answers.length === 0) {
        return question;
    }
    return `${question}\n${answers.map((answer, idx) => `${idx + 1}. ${answer}`).join("\n")}`;
}
export function buildPollStartContent(poll) {
    const normalized = normalizePollInput(poll);
    const answers = normalized.options.map((option, idx) => ({
        id: `answer${idx + 1}`,
        ...buildTextContent(option),
    }));
    const isMultiple = normalized.maxSelections > 1;
    const fallbackText = buildPollFallbackText(normalized.question, answers.map((answer) => getTextContent(answer)));
    return {
        [M_POLL_START]: {
            question: buildTextContent(normalized.question),
            kind: isMultiple ? "m.poll.undisclosed" : "m.poll.disclosed",
            max_selections: normalized.maxSelections,
            answers,
        },
        "m.text": fallbackText,
        "org.matrix.msc1767.text": fallbackText,
    };
}
export function buildPollResponseContent(pollEventId, answerIds) {
    return {
        [M_POLL_RESPONSE]: {
            answers: answerIds,
        },
        [ORG_POLL_RESPONSE]: {
            answers: answerIds,
        },
        "m.relates_to": {
            rel_type: "m.reference",
            event_id: pollEventId,
        },
    };
}
