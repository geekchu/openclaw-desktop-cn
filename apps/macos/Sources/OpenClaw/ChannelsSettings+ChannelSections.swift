import SwiftUI

extension ChannelsSettings {
    func formSection(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        GroupBox(title) {
            VStack(alignment: .leading, spacing: 10) {
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    func channelHeaderActions(_ channel: ChannelItem) -> some View {
        HStack(spacing: 8) {
            if channel.id == "whatsapp" {
                Button("Logout") {
                    Task { await self.store.logoutWhatsApp() }
                }
                .buttonStyle(.bordered)
                .disabled(self.store.whatsappBusy)
            }

            if channel.id == "telegram" {
                Button("Logout") {
                    Task { await self.store.logoutTelegram() }
                }
                .buttonStyle(.bordered)
                .disabled(self.store.telegramBusy)
            }

            Button {
                Task {
                    await self.store.refresh(probe: true)
                    if self.desktopActionsEnabled {
                        await self.store.syncDesktopMessageActions(for: channel.id)
                    }
                }
            } label: {
                if self.store.isRefreshing {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Refresh")
                }
            }
            .buttonStyle(.bordered)
            .disabled(self.store.isRefreshing)
        }
        .controlSize(.small)
    }

    func whatsAppSection(_ channel: ChannelItem) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            self.formSection("Linking") {
                if let message = self.store.whatsappLoginMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let qr = self.store.whatsappLoginQrDataUrl, let image = self.qrImage(from: qr) {
                    Image(nsImage: image)
                        .resizable()
                        .interpolation(.none)
                        .frame(width: 180, height: 180)
                        .cornerRadius(8)
                }

                HStack(spacing: 12) {
                    Button {
                        Task { await self.store.startWhatsAppLogin(force: false) }
                    } label: {
                        if self.store.whatsappBusy {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Show QR")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(self.store.whatsappBusy)

                    Button("Relink") {
                        Task { await self.store.startWhatsAppLogin(force: true) }
                    }
                    .buttonStyle(.bordered)
                    .disabled(self.store.whatsappBusy)
                }
                .font(.caption)
            }

            self.configEditorSection(channelId: "whatsapp")

            if self.desktopActionsEnabled {
                self.desktopMessageActionsSection(channel)
            }
        }
    }

    func genericChannelSection(_ channel: ChannelItem) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            self.configEditorSection(channelId: channel.id)

            if self.desktopActionsEnabled {
                self.desktopMessageActionsSection(channel)
            }
        }
    }

    @ViewBuilder
    private func configEditorSection(channelId: String) -> some View {
        self.formSection("Configuration") {
            ChannelConfigForm(store: self.store, channelId: channelId)
        }

        self.configStatusMessage

        HStack(spacing: 12) {
            Button {
                Task {
                    if self.desktopActionsEnabled {
                        let normalizedTestTarget = self.testTargetValue.trimmingCharacters(in: .whitespacesAndNewlines)
                        self.testTargetValue = normalizedTestTarget
                        await self.store.saveDesktopMessageConfig(
                            channelId: channelId,
                            testTargetValue: normalizedTestTarget)
                        await self.store.refresh(probe: true)
                        await self.store.syncDesktopMessageActions(for: channelId)
                    } else {
                        await self.store.saveConfigDraft()
                    }
                }
            } label: {
                if self.store.isSavingConfig {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Save")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(
                self.store.isSavingConfig
                    || (!self.store.configDirty && !self.testTargetDirty(channelId)))

            Button("Reload") {
                Task {
                    await self.store.reloadConfigDraft()
                    if self.desktopActionsEnabled {
                        self.testTargetValue = self.store.storedTestTargetValue(for: channelId) ?? ""
                        await self.store.syncDesktopMessageActions(for: channelId)
                    }
                }
            }
            .buttonStyle(.bordered)
            .disabled(self.store.isSavingConfig)

            Spacer()
        }
        .font(.caption)
    }

    private func testTargetDirty(_ channelId: String) -> Bool {
        guard self.desktopActionsEnabled else { return false }
        let savedValue = self.store.storedTestTargetValue(for: channelId)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let draftValue = self.testTargetValue.trimmingCharacters(in: .whitespacesAndNewlines)
        return savedValue != draftValue
    }

    @ViewBuilder
    private func desktopMessageActionsSection(_ channel: ChannelItem) -> some View {
        if let testTargetLabel = self.store.testTargetFieldLabel(for: channel.id) {
            self.formSection("Test Target") {
                TextField(testTargetLabel, text: self.$testTargetValue)
                    .textFieldStyle(.roundedBorder)

                if let description = self.store.testTargetFieldDescription(for: channel.id) {
                    Text(description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }

        self.formSection("Actions") {
            HStack(spacing: 12) {
                Button {
                    Task { await self.store.testDesktopMessageChannel(channel.id) }
                } label: {
                    if self.store.channelTesting {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Quick Test")
                    }
                }
                .buttonStyle(.bordered)
                .disabled(self.store.isSavingConfig || self.store.channelTesting || self.store.channelClearing)

                Button("Clear Configuration", role: .destructive) {
                    self.clearConfirmationChannelId = channel.id
                }
                .buttonStyle(.bordered)
                .disabled(self.store.isSavingConfig || self.store.channelTesting || self.store.channelClearing)

                Spacer()
            }
            .font(.caption)
        }

        if self.store.shouldShowPairing(for: channel.id) {
            self.pairingRequestsSection(channel)
        }
    }

    private func pairingRequestsSection(_ channel: ChannelItem) -> some View {
        self.formSection("Pairing Requests") {
            HStack(spacing: 12) {
                Button {
                    Task { await self.store.loadPairingRequests(for: channel.id) }
                } label: {
                    if self.store.pairingLoading {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Refresh")
                    }
                }
                .buttonStyle(.bordered)
                .disabled(self.store.isSavingConfig || self.store.pairingLoading || self.store.pairingApprovalLoading)

                Spacer()
            }
            .font(.caption)

            if self.store.pairingRequests.isEmpty {
                Text(self.store.pairingLoading ? "Loading pairing requests..." : "No pending pairing requests.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(self.store.pairingRequests) { request in
                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(request.code)
                                    .font(.body.monospaced())
                                if let requesterId = request.requesterId, !requesterId.isEmpty {
                                    Text(requesterId)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                if let createdAt = request.createdAt, !createdAt.isEmpty {
                                    Text(createdAt)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }

                            Spacer()

                            Button("Approve") {
                                Task { _ = await self.store.approvePairingCode(request.code, channelId: channel.id) }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(self.store.isSavingConfig || self.store.pairingApprovalLoading)
                        }
                    }
                }
            }

            HStack(spacing: 12) {
                TextField("Enter pairing code", text: self.$pairingCode)
                    .textFieldStyle(.roundedBorder)
                    .font(.body.monospaced())

                Button {
                    let code = self.pairingCode
                    Task {
                        let approved = await self.store.approvePairingCode(code, channelId: channel.id)
                        if approved {
                            self.pairingCode = ""
                        }
                    }
                } label: {
                    if self.store.pairingApprovalLoading {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Approve")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    self.store.isSavingConfig
                        || self.store.pairingApprovalLoading
                        || self.pairingCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .font(.caption)
        }
    }

    @ViewBuilder
    var configStatusMessage: some View {
        if let status = self.store.configStatus {
            Text(status)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
