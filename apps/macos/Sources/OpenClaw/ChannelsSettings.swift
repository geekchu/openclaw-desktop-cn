import AppKit
import SwiftUI

struct ChannelsSettings: View {
    struct ChannelItem: Identifiable, Hashable {
        let id: String
        let title: String
        let detailTitle: String
        let systemImage: String
        let sortOrder: Int
    }

    @Bindable var store: ChannelsStore
    @State var selectedChannel: ChannelItem?
    @State var pairingCode = ""
    @State var testTargetValue = ""
    @State var clearConfirmationChannelId: String?
    let allowedChannelIds: [String]?
    let desktopActionsEnabled: Bool
    let emptyTitle: String
    let emptyDescription: String

    init(
        store: ChannelsStore = .shared,
        allowedChannelIds: [String]? = nil,
        desktopActionsEnabled: Bool = false,
        emptyTitle: String = "Channels",
        emptyDescription: String = "Select a channel to view status and settings.")
    {
        self.store = store
        self.allowedChannelIds = allowedChannelIds
        self.desktopActionsEnabled = desktopActionsEnabled
        self.emptyTitle = emptyTitle
        self.emptyDescription = emptyDescription
    }
}
