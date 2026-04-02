import SwiftUI

@MainActor
struct MessagesSettings: View {
    static let supportedChannelIds = [
        "telegram",
        "discord",
        "slack",
        "feishu",
        "whatsapp",
        "imessage",
        "wecom",
        "dingtalk",
        "qqbot",
    ]

    @Bindable var store: ChannelsStore

    init(store: ChannelsStore = .shared) {
        self.store = store
    }

    var body: some View {
        ChannelsSettings(
            store: self.store,
            allowedChannelIds: Self.supportedChannelIds,
            desktopActionsEnabled: true,
            emptyTitle: "Messages",
            emptyDescription: "Select a message channel to view status and settings.")
    }
}

#if DEBUG
struct MessagesSettings_Previews: PreviewProvider {
    static var previews: some View {
        MessagesSettings()
    }
}
#endif
