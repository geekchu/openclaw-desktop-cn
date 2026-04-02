import { VERSION } from "../version.js";
import { buildBaseHints, mapSensitivePaths } from "./schema.hints.js";
import { asSchemaObject, cloneSchema } from "./schema.shared.js";
import { applyDerivedTags } from "./schema.tags.js";
import { OpenClawSchema } from "./zod-schema.js";
const asJsonSchemaObject = (value) => asSchemaObject(value);
function stripChannelSchema(schema) {
    const next = cloneSchema(schema);
    const root = asJsonSchemaObject(next);
    if (!root || !root.properties) {
        return next;
    }
    // Allow `$schema` in config files for editor tooling, but hide it from the
    // Control UI form schema so it does not show up as a configurable section.
    delete root.properties.$schema;
    if (Array.isArray(root.required)) {
        root.required = root.required.filter((key) => key !== "$schema");
    }
    const channelsNode = asJsonSchemaObject(root.properties.channels);
    if (channelsNode) {
        channelsNode.properties = {};
        channelsNode.required = [];
        channelsNode.additionalProperties = true;
    }
    return next;
}
let baseConfigSchemaStablePayload = null;
function computeBaseConfigSchemaStablePayload() {
    if (baseConfigSchemaStablePayload) {
        return {
            schema: cloneSchema(baseConfigSchemaStablePayload.schema),
            uiHints: cloneSchema(baseConfigSchemaStablePayload.uiHints),
            version: baseConfigSchemaStablePayload.version,
        };
    }
    const schema = OpenClawSchema.toJSONSchema({
        target: "draft-07",
        unrepresentable: "any",
    });
    schema.title = "OpenClawConfig";
    const stablePayload = {
        schema: stripChannelSchema(schema),
        uiHints: applyDerivedTags(mapSensitivePaths(OpenClawSchema, "", buildBaseHints())),
        version: VERSION,
    };
    baseConfigSchemaStablePayload = stablePayload;
    return {
        schema: cloneSchema(stablePayload.schema),
        uiHints: cloneSchema(stablePayload.uiHints),
        version: stablePayload.version,
    };
}
export function computeBaseConfigSchemaResponse(params) {
    const stablePayload = computeBaseConfigSchemaStablePayload();
    return {
        schema: stablePayload.schema,
        uiHints: stablePayload.uiHints,
        version: stablePayload.version,
        generatedAt: params?.generatedAt ?? new Date().toISOString(),
    };
}
