import OpenClawProtocol
import SwiftUI
import Testing
@testable import OpenClaw

private typealias SnapshotAnyCodable = OpenClaw.AnyCodable

private let channelOrder = ["whatsapp", "telegram", "signal", "imessage"]
private let channelLabels = [
    "whatsapp": "WhatsApp",
    "telegram": "Telegram",
    "signal": "Signal",
    "imessage": "iMessage",
]
private let channelDefaultAccountId = [
    "whatsapp": "default",
    "telegram": "default",
    "signal": "default",
    "imessage": "default",
]

@MainActor
private func makeChannelsStore(
    channels: [String: SnapshotAnyCodable],
    ts: Double = 1_700_000_000_000) -> ChannelsStore
{
    let store = ChannelsStore(isPreview: true)
    store.snapshot = ChannelsStatusSnapshot(
        ts: ts,
        channelOrder: channelOrder,
        channelLabels: channelLabels,
        channelDetailLabels: nil,
        channelSystemImages: nil,
        channelMeta: nil,
        channels: channels,
        channelAccounts: [:],
        channelDefaultAccountId: channelDefaultAccountId)
    return store
}

@Suite(.serialized)
@MainActor
struct ChannelsSettingsSmokeTests {
    @Test func `channels settings builds body with snapshot`() {
        let store = makeChannelsStore(
            channels: [
                "whatsapp": SnapshotAnyCodable([
                    "configured": true,
                    "linked": true,
                    "authAgeMs": 86_400_000,
                    "self": ["e164": "+15551234567"],
                    "running": true,
                    "connected": false,
                    "lastConnectedAt": 1_700_000_000_000,
                    "lastDisconnect": [
                        "at": 1_700_000_050_000,
                        "status": 401,
                        "error": "logged out",
                        "loggedOut": true,
                    ],
                    "reconnectAttempts": 2,
                    "lastMessageAt": 1_700_000_060_000,
                    "lastEventAt": 1_700_000_060_000,
                    "lastError": "needs login",
                ]),
                "telegram": SnapshotAnyCodable([
                    "configured": true,
                    "tokenSource": "env",
                    "running": true,
                    "mode": "polling",
                    "lastStartAt": 1_700_000_000_000,
                    "probe": [
                        "ok": true,
                        "status": 200,
                        "elapsedMs": 120,
                        "bot": ["id": 123, "username": "openclawbot"],
                        "webhook": ["url": "https://example.com/hook", "hasCustomCert": false],
                    ],
                    "lastProbeAt": 1_700_000_050_000,
                ]),
                "signal": SnapshotAnyCodable([
                    "configured": true,
                    "baseUrl": "http://127.0.0.1:8080",
                    "running": true,
                    "lastStartAt": 1_700_000_000_000,
                    "probe": [
                        "ok": true,
                        "status": 200,
                        "elapsedMs": 140,
                        "version": "0.12.4",
                    ],
                    "lastProbeAt": 1_700_000_050_000,
                ]),
                "imessage": SnapshotAnyCodable([
                    "configured": false,
                    "running": false,
                    "lastError": "not configured",
                    "probe": ["ok": false, "error": "imsg not found (imsg)"],
                    "lastProbeAt": 1_700_000_050_000,
                ]),
            ])

        store.whatsappLoginMessage = "Scan QR"
        store.whatsappLoginQrDataUrl =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ay7pS8AAAAASUVORK5CYII="

        let view = ChannelsSettings(store: store)
        _ = view.body
    }

    @Test func `channels settings builds body without snapshot`() {
        let store = makeChannelsStore(
            channels: [
                "whatsapp": SnapshotAnyCodable([
                    "configured": false,
                    "linked": false,
                    "running": false,
                    "connected": false,
                    "reconnectAttempts": 0,
                ]),
                "telegram": SnapshotAnyCodable([
                    "configured": false,
                    "running": false,
                    "lastError": "bot missing",
                    "probe": [
                        "ok": false,
                        "status": 403,
                        "error": "unauthorized",
                        "elapsedMs": 120,
                    ],
                    "lastProbeAt": 1_700_000_100_000,
                ]),
                "signal": SnapshotAnyCodable([
                    "configured": false,
                    "baseUrl": "http://127.0.0.1:8080",
                    "running": false,
                    "lastError": "not configured",
                    "probe": [
                        "ok": false,
                        "status": 404,
                        "error": "unreachable",
                        "elapsedMs": 200,
                    ],
                    "lastProbeAt": 1_700_000_200_000,
                ]),
                "imessage": SnapshotAnyCodable([
                    "configured": false,
                    "running": false,
                    "lastError": "not configured",
                    "cliPath": "imsg",
                    "probe": ["ok": false, "error": "imsg not found (imsg)"],
                    "lastProbeAt": 1_700_000_200_000,
                ]),
            ])

        let view = ChannelsSettings(store: store)
        _ = view.body
    }

    @Test func `messages settings keeps the legacy nine-channel order`() {
        let store = makeChannelsStore(channels: [:])
        let view = ChannelsSettings(
            store: store,
            allowedChannelIds: MessagesSettings.supportedChannelIds,
            desktopActionsEnabled: true)

        #expect(view.orderedChannels.map(\.id) == MessagesSettings.supportedChannelIds)
    }

    @Test func `messages settings keeps fixed order even when some channels are configured`() {
        let store = ChannelsStore(isPreview: true)
        store.snapshot = ChannelsStatusSnapshot(
            ts: 1_700_000_000_000,
            channelOrder: ["whatsapp", "slack", "telegram", "discord"],
            channelLabels: [
                "telegram": "Telegram",
                "discord": "Discord",
                "slack": "Slack",
                "whatsapp": "WhatsApp",
            ],
            channelDetailLabels: nil,
            channelSystemImages: nil,
            channelMeta: nil,
            channels: [
                "whatsapp": SnapshotAnyCodable([
                    "configured": false,
                    "linked": false,
                    "running": false,
                    "connected": false,
                    "reconnectAttempts": 0,
                ]),
                "telegram": SnapshotAnyCodable([
                    "configured": true,
                    "running": true,
                ]),
                "discord": SnapshotAnyCodable([
                    "configured": false,
                    "running": false,
                ]),
                "slack": SnapshotAnyCodable([
                    "configured": false,
                    "running": false,
                ]),
            ],
            channelAccounts: [:],
            channelDefaultAccountId: ["telegram": "default"])

        let view = ChannelsSettings(
            store: store,
            allowedChannelIds: MessagesSettings.supportedChannelIds,
            desktopActionsEnabled: true)

        #expect(view.orderedChannels.map(\.id) == MessagesSettings.supportedChannelIds)
    }

    @Test func `generic message channels surface probe failures as errors`() {
        let store = ChannelsStore(isPreview: true)
        store.snapshot = ChannelsStatusSnapshot(
            ts: 1_700_000_000_000,
            channelOrder: ["feishu"],
            channelLabels: ["feishu": "Feishu"],
            channelDetailLabels: nil,
            channelSystemImages: nil,
            channelMeta: nil,
            channels: [
                "feishu": SnapshotAnyCodable([
                    "configured": true,
                    "running": true,
                    "probe": [
                        "ok": false,
                        "status": 401,
                        "error": "token expired",
                    ],
                    "lastProbeAt": 1_700_000_050_000,
                ])
            ],
            channelAccounts: [:],
            channelDefaultAccountId: ["feishu": "default"])

        let view = ChannelsSettings(store: store, allowedChannelIds: ["feishu"])
        let channel = try #require(view.orderedChannels.first)

        #expect(view.channelHasError(channel))
        #expect(view.channelTint(channel) == .orange)
        #expect(view.channelSummary(channel) == "Error")
        #expect(view.channelDetails(channel)?.contains("token expired") == true)
    }

    @Test func `wecom configured state stays healthy in messages ui`() {
        let store = ChannelsStore(isPreview: true)
        store.snapshot = ChannelsStatusSnapshot(
            ts: 1_700_000_000_000,
            channelOrder: ["wecom"],
            channelLabels: ["wecom": "WeCom"],
            channelDetailLabels: nil,
            channelSystemImages: nil,
            channelMeta: nil,
            channels: [
                "wecom": SnapshotAnyCodable([
                    "configured": true,
                ])
            ],
            channelAccounts: [:],
            channelDefaultAccountId: [:])

        let view = ChannelsSettings(store: store, allowedChannelIds: ["wecom"], desktopActionsEnabled: true)
        let channel = try #require(view.orderedChannels.first)

        #expect(view.channelTint(channel) == .green)
        #expect(!view.channelHasError(channel))
        #expect(view.channelSummary(channel) == "Configured")
    }

    @Test func `imessage healthy probe shows ready state in messages ui`() {
        let store = ChannelsStore(isPreview: true)
        store.snapshot = ChannelsStatusSnapshot(
            ts: 1_700_000_000_000,
            channelOrder: ["imessage"],
            channelLabels: ["imessage": "iMessage"],
            channelDetailLabels: nil,
            channelSystemImages: nil,
            channelMeta: nil,
            channels: [
                "imessage": SnapshotAnyCodable([
                    "configured": true,
                    "running": false,
                    "probe": ["ok": true],
                ])
            ],
            channelAccounts: [:],
            channelDefaultAccountId: [:])

        let view = ChannelsSettings(store: store, allowedChannelIds: ["imessage"], desktopActionsEnabled: true)
        let channel = try #require(view.orderedChannels.first)

        #expect(view.channelTint(channel) == .green)
        #expect(!view.channelHasError(channel))
    }

    @Test func `whatsapp linked state stays healthy in messages ui`() {
        let store = ChannelsStore(isPreview: true)
        store.snapshot = ChannelsStatusSnapshot(
            ts: 1_700_000_000_000,
            channelOrder: ["whatsapp"],
            channelLabels: ["whatsapp": "WhatsApp"],
            channelDetailLabels: nil,
            channelSystemImages: nil,
            channelMeta: nil,
            channels: [
                "whatsapp": SnapshotAnyCodable([
                    "configured": true,
                    "linked": true,
                    "running": false,
                    "connected": false,
                    "reconnectAttempts": 0,
                ])
            ],
            channelAccounts: [:],
            channelDefaultAccountId: [:])

        let view = ChannelsSettings(store: store, allowedChannelIds: ["whatsapp"], desktopActionsEnabled: true)
        let channel = try #require(view.orderedChannels.first)

        #expect(view.channelTint(channel) == .green)
        #expect(view.channelSummary(channel) == "Linked")
    }
}
