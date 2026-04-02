import Testing
@testable import OpenClaw

@Suite(.serialized)
@MainActor
struct ConfigStoreTests {
    @Test func `load uses remote in remote mode`() async {
        var localHit = false
        var remoteHit = false
        await ConfigStore._testSetOverrides(.init(
            isRemoteMode: { true },
            loadLocal: { localHit = true; return ["local": true] },
            loadRemote: { remoteHit = true; return ["remote": true] }))

        let result = await ConfigStore.load()

        await ConfigStore._testClearOverrides()
        #expect(remoteHit)
        #expect(!localHit)
        #expect(result["remote"] as? Bool == true)
    }

    @Test func `load uses local in local mode`() async {
        var localHit = false
        var remoteHit = false
        await ConfigStore._testSetOverrides(.init(
            isRemoteMode: { false },
            loadLocal: { localHit = true; return ["local": true] },
            loadRemote: { remoteHit = true; return ["remote": true] }))

        let result = await ConfigStore.load()

        await ConfigStore._testClearOverrides()
        #expect(localHit)
        #expect(!remoteHit)
        #expect(result["local"] as? Bool == true)
    }

    @Test func `save routes to remote in remote mode`() async throws {
        var localHit = false
        var remoteHit = false
        await ConfigStore._testSetOverrides(.init(
            isRemoteMode: { true },
            saveLocal: { _ in localHit = true },
            saveRemote: { _ in remoteHit = true }))

        try await ConfigStore.save(["remote": true])

        await ConfigStore._testClearOverrides()
        #expect(remoteHit)
        #expect(!localHit)
    }

    @Test func `save routes to local in local mode`() async throws {
        var localHit = false
        var remoteHit = false
        await ConfigStore._testSetOverrides(.init(
            isRemoteMode: { false },
            saveLocal: { _ in localHit = true },
            saveRemote: { _ in remoteHit = true }))

        try await ConfigStore.save(["local": true])

        await ConfigStore._testClearOverrides()
        #expect(localHit)
        #expect(!remoteHit)
    }

    @Test func `local fallback restores redacted sensitive values before saving`() {
        let restored = restoreLocalRedactedSentinels(
            in: [
                "channels": [
                    "telegram": [
                        "botToken": "__OPENCLAW_REDACTED__",
                        "mode": "polling",
                    ]
                ]
            ],
            original: [
                "channels": [
                    "telegram": [
                        "botToken": "secret-token",
                        "mode": "webhook",
                    ]
                ]
            ])

        let channels = restored["channels"] as? [String: Any]
        let telegram = channels?["telegram"] as? [String: Any]
        #expect(telegram?["botToken"] as? String == "secret-token")
        #expect(telegram?["mode"] as? String == "polling")
    }
}
