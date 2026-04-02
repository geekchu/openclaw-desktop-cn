import Foundation

extension ChannelsStore {
    private struct ParsedChannelStatus {
        let configured: Bool
        let linked: Bool?
        let running: Bool?
        let connected: Bool?
        let probeOk: Bool?
        let lastError: String?
        let probeError: String?
    }

    private struct ChannelTestResult {
        let success: Bool
        let message: String
        let error: String?
    }

    private enum ChannelStatusCheck {
        case ready(status: String)
        case notConfigured
        case notReady(status: String, error: String)
    }

    private static let channelsNeedingSendTest = Set(["telegram", "discord", "slack", "feishu"])
    private static let channelsUsingDefaultPairing = Set([
        "telegram",
        "discord",
        "slack",
        "feishu",
        "imessage",
        "whatsapp",
    ])
    private static let testTargetEnvKeys: [String: String] = [
        "telegram": "OPENCLAW_TELEGRAM_USERID",
        "discord": "OPENCLAW_DISCORD_TESTCHANNELID",
        "slack": "OPENCLAW_SLACK_TESTCHANNELID",
        "feishu": "OPENCLAW_FEISHU_TESTCHATID",
    ]
    private static let testTargetFieldLabels: [String: String] = [
        "telegram": "Telegram User ID",
        "discord": "Discord Test Channel ID",
        "slack": "Slack Test Channel ID",
        "feishu": "Feishu Test Chat ID",
    ]
    private static let testTargetFieldDescriptions: [String: String] = [
        "telegram": "Used for the Quick Test send action.",
        "discord": "Used for the Quick Test send action.",
        "slack": "Used for the Quick Test send action.",
        "feishu": "Used for the Quick Test send action.",
    ]

    func supportsDesktopActions(_ channelId: String) -> Bool {
        MessagesSettings.supportedChannelIds.contains(channelId)
    }

    func storedTestTargetValue(for channelId: String) -> String? {
        self.testTargetValue(for: channelId)
    }

    func testTargetFieldLabel(for channelId: String) -> String? {
        Self.testTargetFieldLabels[channelId]
    }

    func testTargetFieldDescription(for channelId: String) -> String? {
        Self.testTargetFieldDescriptions[channelId]
    }

    func effectiveDmPolicy(for channelId: String) -> String? {
        let path: ConfigPath = [.key("channels"), .key(channelId), .key("dmPolicy")]
        let raw = (self.configValue(at: path) as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let raw, !raw.isEmpty {
            return raw
        }
        if Self.channelsUsingDefaultPairing.contains(channelId) {
            return "pairing"
        }
        return nil
    }

    func shouldShowPairing(for channelId: String) -> Bool {
        self.effectiveDmPolicy(for: channelId) == "pairing"
    }

    func syncDesktopMessageActions(for channelId: String?) async {
        guard let channelId, self.supportsDesktopActions(channelId) else {
            self.pairingRequests = []
            return
        }
        guard self.shouldShowPairing(for: channelId) else {
            self.pairingRequests = []
            return
        }
        await self.loadPairingRequests(for: channelId)
    }

    func saveDesktopMessageConfig(channelId: String, testTargetValue: String) async {
        guard !self.isSavingConfig else { return }
        self.isSavingConfig = true
        defer { self.isSavingConfig = false }

        do {
            var root = self.configDraft
            let hasMeaningfulConfig = self.desktopChannelHasMeaningfulConfig(channelId: channelId, root: root)
            if !hasMeaningfulConfig {
                self.removeDesktopChannelConfig(channelId: channelId, root: &root)
            }
            self.setDesktopPluginEnabled(
                hasMeaningfulConfig,
                channelId: channelId,
                root: &root)
            try await ConfigStore.save(root)
            try self.writeStoredTestTarget(testTargetValue, for: channelId)
            await self.loadConfig()
            self.configStatus = "\(self.resolveChannelLabel(channelId)) configuration saved."
        } catch {
            self.configStatus = error.localizedDescription
        }
    }

    func clearChannelConfig(_ channelId: String) async {
        guard !self.channelClearing else { return }
        self.channelClearing = true
        defer { self.channelClearing = false }

        var nextRoot = self.configDraft
        if var channels = nextRoot["channels"] as? [String: Any] {
            channels.removeValue(forKey: channelId)
            if channels.isEmpty {
                nextRoot.removeValue(forKey: "channels")
            } else {
                nextRoot["channels"] = channels
            }
        }
        self.setDesktopPluginEnabled(false, channelId: channelId, root: &nextRoot)

        do {
            try await ConfigStore.save(nextRoot)
            try self.clearStoredTestTarget(for: channelId)
            self.configStatus = "\(self.resolveChannelLabel(channelId)) configuration cleared."
            await self.loadConfig()
            await self.refresh(probe: true)
            await self.syncDesktopMessageActions(for: channelId)
        } catch {
            self.configStatus = error.localizedDescription
        }
    }

    func loadPairingRequests(for channelId: String) async {
        guard !self.pairingLoading else { return }
        self.pairingLoading = true
        defer { self.pairingLoading = false }

        let result = await self.runOpenClaw(
            subcommand: "pairing",
            extraArgs: ["list", "--channel", channelId, "--json"],
            timeout: 15)
        guard result.success else {
            self.pairingRequests = []
            return
        }

        let trimmed = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != "[]", trimmed != "{}" else {
            self.pairingRequests = []
            return
        }

        guard let data = self.extractJSONPayload(from: trimmed)?.data(using: .utf8) else {
            self.pairingRequests = []
            return
        }

        do {
            if let wrapper = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let requestsValue = wrapper["requests"]
            {
                let wrapped = try JSONSerialization.data(withJSONObject: requestsValue)
                self.pairingRequests = try JSONDecoder().decode([ChannelPairingRequest].self, from: wrapped)
                return
            }
            self.pairingRequests = try JSONDecoder().decode([ChannelPairingRequest].self, from: data)
        } catch {
            self.pairingRequests = []
        }
    }

    @discardableResult
    func approvePairingCode(_ code: String, channelId: String) async -> Bool {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        guard !self.pairingApprovalLoading else { return false }
        self.pairingApprovalLoading = true
        defer { self.pairingApprovalLoading = false }

        let result = await self.runOpenClaw(
            subcommand: "pairing",
            extraArgs: ["approve", channelId, trimmed, "--notify"],
            timeout: 20)
        if result.success {
            let output = self.cleanShellMessage(result.stdout)
            self.configStatus = output.isEmpty ? "Pairing approved." : output
            await self.loadPairingRequests(for: channelId)
            return true
        } else {
            let message = self.cleanShellMessage(result.stderr.isEmpty ? result.stdout : result.stderr)
            self.configStatus = message.isEmpty ? "Pairing approval failed." : "Pairing approval failed: \(message)"
            return false
        }
    }

    func testDesktopMessageChannel(_ channelId: String) async {
        guard !self.channelTesting else { return }
        self.channelTesting = true
        defer { self.channelTesting = false }

        let result = await self.runChannelTest(channelId: channelId)
        if result.success {
            self.configStatus = result.message
        } else {
            self.configStatus = result.error ?? result.message
        }
        await self.refresh(probe: true)
    }

    private func runChannelTest(channelId: String) async -> ChannelTestResult {
        let needsProbe = channelId == "imessage"
        let statusArgs = needsProbe ? ["status", "--json", "--probe"] : ["status", "--json"]
        let statusResult = await self.runOpenClaw(
            subcommand: "channels",
            extraArgs: statusArgs,
            timeout: 20)
        guard statusResult.success else {
            return ChannelTestResult(
                success: false,
                message: "\(channelId) unavailable",
                error: self.cleanShellMessage(statusResult.stderr.isEmpty ? statusResult.stdout : statusResult.stderr))
        }

        guard
            let jsonString = self.extractJSONPayload(from: statusResult.stdout),
            let data = jsonString.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let status = self.parseChannelStatus(json: json, channelId: channelId)
        else {
            return ChannelTestResult(
                success: false,
                message: "\(channelId) unavailable",
                error: "Failed to parse channel status.")
        }

        switch self.evaluateChannelStatus(channelId: channelId, status: status) {
        case .notConfigured:
            return ChannelTestResult(
                success: false,
                message: "\(channelId) not configured",
                error: "Configure and save \(self.resolveChannelLabel(channelId)) first.")
        case let .notReady(status, error):
            return ChannelTestResult(
                success: false,
                message: "\(self.resolveChannelLabel(channelId)) \(status)",
                error: error)
        case let .ready(statusMessage):
            guard Self.channelsNeedingSendTest.contains(channelId) else {
                return ChannelTestResult(
                    success: true,
                    message: "\(self.resolveChannelLabel(channelId)) status OK (\(statusMessage))",
                    error: nil)
            }

            guard let target = self.testTargetValue(for: channelId) else {
                return ChannelTestResult(
                    success: true,
                    message: "\(self.resolveChannelLabel(channelId)) status OK (\(statusMessage))",
                    error: nil)
            }

            let message = """
            OpenClaw test message

            Connection verified.
            """
            let sendResult = await self.runOpenClaw(
                subcommand: "message",
                extraArgs: ["send", "--channel", channelId, "--target", target, "--message", message, "--json"],
                timeout: 25)
            guard sendResult.success else {
                return ChannelTestResult(
                    success: false,
                    message: "\(self.resolveChannelLabel(channelId)) send failed",
                    error: self.cleanShellMessage(sendResult.stderr.isEmpty ? sendResult.stdout : sendResult.stderr))
            }
            if self.messageSendSucceeded(sendResult.stdout) {
                return ChannelTestResult(
                    success: true,
                    message: "\(self.resolveChannelLabel(channelId)) test message sent (\(statusMessage))",
                    error: nil)
            }
            return ChannelTestResult(
                success: false,
                message: "\(self.resolveChannelLabel(channelId)) send failed",
                error: self.cleanShellMessage(sendResult.stdout))
        }
    }

    private func parseChannelStatus(json: [String: Any], channelId: String) -> ParsedChannelStatus? {
        guard let channels = json["channels"] as? [String: Any],
              let summary = channels[channelId] as? [String: Any]
        else {
            return nil
        }
        let defaultAccountId = ((json["channelDefaultAccountId"] as? [String: Any])?[channelId] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let accounts = ((json["channelAccounts"] as? [String: Any])?[channelId] as? [[String: Any]]) ?? []
        let defaultAccount = accounts.first(where: {
            (($0["accountId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "") == defaultAccountId
        }) ?? accounts.first

        return ParsedChannelStatus(
            configured: self.readStatusBool(defaultAccount, key: "configured")
                ?? self.readStatusBool(summary, key: "configured")
                ?? false,
            linked: self.readStatusBool(defaultAccount, key: "linked")
                ?? self.readStatusBool(summary, key: "linked"),
            running: self.readStatusBool(defaultAccount, key: "running")
                ?? self.readStatusBool(summary, key: "running"),
            connected: self.readStatusBool(defaultAccount, key: "connected")
                ?? self.readStatusBool(summary, key: "connected"),
            probeOk: self.readProbeBool(defaultAccount) ?? self.readProbeBool(summary),
            lastError: self.readStatusString(defaultAccount, key: "lastError")
                ?? self.readStatusString(summary, key: "lastError"),
            probeError: self.readProbeError(defaultAccount) ?? self.readProbeError(summary))
    }

    private func evaluateChannelStatus(channelId: String, status: ParsedChannelStatus) -> ChannelStatusCheck {
        if !status.configured {
            return .notConfigured
        }

        if channelId == "whatsapp", status.linked != true {
            return .notReady(
                status: "waiting for login",
                error: "Scan the WhatsApp QR code before testing.")
        }

        if channelId == "imessage", status.probeOk != true {
            return .notReady(
                status: "probe failed",
                error: status.probeError ?? status.lastError ?? "Confirm iMessage is available and try again.")
        }

        if ["dingtalk", "qqbot"].contains(channelId), status.running != true {
            return .notReady(
                status: "not running",
                error: status.lastError ?? status.probeError ?? "Confirm the channel gateway is running and try again.")
        }

        if channelId == "qqbot", status.connected != true {
            return .notReady(
                status: status.running == true ? "running but disconnected" : "not connected",
                error: status.lastError ?? status.probeError ?? "Confirm QQ is connected and try again.")
        }

        if status.linked == true {
            return .ready(status: "linked")
        }
        if status.connected == true {
            return .ready(status: "connected")
        }
        if status.running == true {
            return .ready(status: "running")
        }
        if status.probeOk == true {
            return .ready(status: "probe OK")
        }
        return .ready(status: "configured")
    }

    private func messageSendSucceeded(_ output: String) -> Bool {
        guard
            let jsonString = self.extractJSONPayload(from: output),
            let data = jsonString.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            let lower = output.lowercased()
            return !lower.contains("error") && !lower.contains("failed")
        }
        if json["ok"] as? Bool == true || json["success"] as? Bool == true || json["messageId"] != nil {
            return true
        }
        guard let payload = json["payload"] as? [String: Any] else { return false }
        if payload["ok"] as? Bool == true || payload["messageId"] != nil {
            return true
        }
        if let result = payload["result"] as? [String: Any], result["messageId"] != nil {
            return true
        }
        return false
    }

    private func testTargetValue(for channelId: String) -> String? {
        guard let key = Self.testTargetEnvKeys[channelId] else { return nil }
        let envValue = ProcessInfo.processInfo.environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let envValue, !envValue.isEmpty {
            return envValue
        }
        let envUrl = OpenClawPaths.configURL.deletingLastPathComponent().appendingPathComponent(".env")
        guard let contents = try? String(contentsOf: envUrl), !contents.isEmpty else { return nil }
        for line in contents.split(whereSeparator: \.isNewline) {
            let raw = String(line).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !raw.isEmpty, !raw.hasPrefix("#") else { continue }
            let normalized = raw.hasPrefix("export ")
                ? String(raw.dropFirst("export ".count))
                : raw
            let parts = normalized.split(separator: "=", maxSplits: 1).map(String.init)
            guard parts.count == 2, parts[0].trimmingCharacters(in: .whitespacesAndNewlines) == key else {
                continue
            }
            let value = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            if !value.isEmpty {
                return value
            }
        }
        return nil
    }

    private func clearStoredTestTarget(for channelId: String) throws {
        guard let key = Self.testTargetEnvKeys[channelId] else { return }
        let envUrl = OpenClawPaths.configURL.deletingLastPathComponent().appendingPathComponent(".env")
        guard FileManager.default.fileExists(atPath: envUrl.path) else { return }
        let contents = try String(contentsOf: envUrl)
        let exportPrefix = "export \(key)="
        let barePrefix = "\(key)="
        let lines = contents
            .split(whereSeparator: \.isNewline, omittingEmptySubsequences: false)
        let filteredLines = lines.filter { rawLine in
                let line = String(rawLine).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !line.isEmpty else { return true }
                if line.hasPrefix(exportPrefix) {
                    return false
                }
                if line.hasPrefix(barePrefix), !line.hasPrefix("export ") {
                    return false
                }
                return true
            }
        guard filteredLines.count != lines.count else { return }
        let filtered = filteredLines.map(String.init).joined(separator: "\n")
        try filtered.write(to: envUrl, atomically: true, encoding: .utf8)
    }

    private func writeStoredTestTarget(_ rawValue: String, for channelId: String) throws {
        guard let key = Self.testTargetEnvKeys[channelId] else { return }
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty {
            try self.clearStoredTestTarget(for: channelId)
            return
        }

        let envUrl = OpenClawPaths.configURL.deletingLastPathComponent().appendingPathComponent(".env")
        let contents = (try? String(contentsOf: envUrl)) ?? ""
        let escapedValue = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let replacement = "export \(key)=\"\(escapedValue)\""
        let exportPrefix = "export \(key)="
        let barePrefix = "\(key)="
        var lines = contents.isEmpty
            ? []
            : contents.split(whereSeparator: \.isNewline, omittingEmptySubsequences: false).map(String.init)
        var replaced = false

        for index in lines.indices {
            let trimmed = lines[index].trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.hasPrefix(exportPrefix) || (trimmed.hasPrefix(barePrefix) && !trimmed.hasPrefix("export ")) {
                lines[index] = replacement
                replaced = true
                break
            }
        }

        if !replaced {
            lines.append(replacement)
        }

        try FileManager.default.createDirectory(
            at: envUrl.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: nil)
        try lines.joined(separator: "\n").write(to: envUrl, atomically: true, encoding: .utf8)
    }

    private func setDesktopPluginEnabled(_ enabled: Bool, channelId: String, root: inout [String: Any]) {
        var plugins = root["plugins"] as? [String: Any] ?? [:]
        var entries = plugins["entries"] as? [String: Any] ?? [:]

        if enabled {
            var entry = entries[channelId] as? [String: Any] ?? [:]
            entry["enabled"] = true
            entries[channelId] = entry
        } else {
            entries.removeValue(forKey: channelId)
        }

        if entries.isEmpty {
            plugins.removeValue(forKey: "entries")
        } else {
            plugins["entries"] = entries
        }

        if plugins.isEmpty {
            root.removeValue(forKey: "plugins")
        } else {
            root["plugins"] = plugins
        }
    }

    private func removeDesktopChannelConfig(channelId: String, root: inout [String: Any]) {
        guard var channels = root["channels"] as? [String: Any] else { return }
        channels.removeValue(forKey: channelId)
        if channels.isEmpty {
            root.removeValue(forKey: "channels")
        } else {
            root["channels"] = channels
        }
    }

    private func desktopChannelHasMeaningfulConfig(channelId: String, root: [String: Any]) -> Bool {
        guard let channels = root["channels"] as? [String: Any],
              let channel = channels[channelId]
        else {
            return false
        }
        return self.hasMeaningfulChannelConfigValue(channel)
    }

    private func hasMeaningfulChannelConfigValue(_ value: Any) -> Bool {
        switch value {
        case is NSNull:
            return false
        case let text as String:
            return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case let boolean as Bool:
            return boolean
        case is Int, is Int8, is Int16, is Int32, is Int64,
            is UInt, is UInt8, is UInt16, is UInt32, is UInt64,
            is Double, is Float, is NSNumber:
            return true
        case let array as [Any]:
            return array.contains { self.hasMeaningfulChannelConfigValue($0) }
        case let dict as [String: Any]:
            return dict.contains { key, item in
                if key == "enabled" {
                    return false
                }
                return self.hasMeaningfulChannelConfigValue(item)
            }
        default:
            return false
        }
    }

    private func readStatusBool(_ value: [String: Any]?, key: String) -> Bool? {
        value?[key] as? Bool
    }

    private func readStatusString(_ value: [String: Any]?, key: String) -> String? {
        let text = (value?[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return text?.isEmpty == false ? text : nil
    }

    private func readProbeBool(_ value: [String: Any]?) -> Bool? {
        (value?["probe"] as? [String: Any])?["ok"] as? Bool
    }

    private func readProbeError(_ value: [String: Any]?) -> String? {
        let text = ((value?["probe"] as? [String: Any])?["error"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return text?.isEmpty == false ? text : nil
    }

    private func runOpenClaw(
        subcommand: String,
        extraArgs: [String],
        timeout: Double) async -> ShellExecutor.ShellResult
    {
        let command = CommandResolver.openclawCommand(subcommand: subcommand, extraArgs: extraArgs)
        return await ShellExecutor.runDetailed(command: command, cwd: nil, env: nil, timeout: timeout)
    }

    private func extractJSONPayload(from output: String) -> String? {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.first == "{" || trimmed.first == "[" {
            return trimmed
        }
        guard let start = trimmed.firstIndex(where: { $0 == "{" || $0 == "[" }) else { return nil }
        guard let end = trimmed.lastIndex(where: { $0 == "}" || $0 == "]" }), end >= start else { return nil }
        return String(trimmed[start...end])
    }

    private func cleanShellMessage(_ raw: String) -> String {
        raw
            .replacingOccurrences(of: "\u{001B}\\[[0-9;]*[A-Za-z]", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
