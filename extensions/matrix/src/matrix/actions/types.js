import { MATRIX_ANNOTATION_RELATION_TYPE, MATRIX_REACTION_EVENT_TYPE, } from "../reaction-common.js";
export const MsgType = {
    Text: "m.text",
};
export const RelationType = {
    Replace: "m.replace",
    Annotation: MATRIX_ANNOTATION_RELATION_TYPE,
};
export const EventType = {
    RoomMessage: "m.room.message",
    RoomPinnedEvents: "m.room.pinned_events",
    RoomTopic: "m.room.topic",
    Reaction: MATRIX_REACTION_EVENT_TYPE,
};
