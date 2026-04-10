import { MATRIX_ANNOTATION_RELATION_TYPE, MATRIX_REACTION_EVENT_TYPE, } from "../reaction-common.js";
// Message types
export const MsgType = {
    Text: "m.text",
    Image: "m.image",
    Audio: "m.audio",
    Video: "m.video",
    File: "m.file",
    Notice: "m.notice",
};
// Relation types
export const RelationType = {
    Annotation: MATRIX_ANNOTATION_RELATION_TYPE,
    Replace: "m.replace",
    Thread: "m.thread",
};
// Event types
export const EventType = {
    Direct: "m.direct",
    Reaction: MATRIX_REACTION_EVENT_TYPE,
    RoomMessage: "m.room.message",
};
export const MATRIX_OPENCLAW_FINALIZED_PREVIEW_KEY = "com.openclaw.finalized_preview";
