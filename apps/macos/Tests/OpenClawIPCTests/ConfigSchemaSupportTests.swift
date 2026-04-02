import Foundation
import Testing
@testable import OpenClaw

@Suite(.serialized)
struct ConfigSchemaSupportTests {
    @Test func `sensitive redacted values render as empty fields`() {
        #expect(
            visibleSensitiveStringValue(
                "__OPENCLAW_REDACTED__",
                defaultValue: nil,
                sensitive: true) == "")
        #expect(
            visibleSensitiveStringValue(
                "__OPENCLAW_REDACTED__",
                defaultValue: nil,
                sensitive: false) == "__OPENCLAW_REDACTED__")
    }

    @Test func `union fields default to string editors when empty`() throws {
        let node = try #require(
            ConfigSchemaNode(raw: [
                "anyOf": [
                    ["type": "string"],
                    ["type": "number"],
                ]
            ]))

        let resolved = node.resolvedFormNode(preferredValue: nil)
        #expect(resolved.schemaType == "string")
    }

    @Test func `union fields prefer object variants that match discriminators`() throws {
        let node = try #require(
            ConfigSchemaNode(raw: [
                "anyOf": [
                    ["type": "string"],
                    [
                        "oneOf": [
                            [
                                "type": "object",
                                "properties": [
                                    "source": ["const": "env"],
                                    "id": ["type": "string"],
                                ],
                            ],
                            [
                                "type": "object",
                                "properties": [
                                    "source": ["const": "file"],
                                    "id": ["type": "string"],
                                ],
                            ],
                        ]
                    ],
                ]
            ]))

        let resolved = node.resolvedFormNode(preferredValue: [
            "source": "file",
            "id": "/providers/openai/apiKey",
        ])

        #expect(resolved.schemaType == "object")
        #expect(resolved.properties["source"]?.constValue as? String == "file")
    }
}
