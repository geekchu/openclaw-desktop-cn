import { readStringParam } from "../runtime-api.js";
export function readDiscordParentIdParam(params) {
    if (params.clearParent === true) {
        return null;
    }
    if (params.parentId === null) {
        return null;
    }
    return readStringParam(params, "parentId");
}
