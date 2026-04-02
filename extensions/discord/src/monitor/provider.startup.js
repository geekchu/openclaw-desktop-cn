import { ReadyListener, } from "@buape/carbon";
import { VoicePlugin } from "@buape/carbon/voice";
import { isDangerousNameMatchingEnabled } from "openclaw/plugin-sdk/config-runtime";
import { danger } from "openclaw/plugin-sdk/runtime-env";
import { DiscordMessageListener, DiscordPresenceListener, DiscordReactionListener, DiscordReactionRemoveListener, DiscordThreadUpdateListener, registerDiscordListener, } from "./listeners.js";
import { resolveDiscordPresenceUpdate } from "./presence.js";
export function createDiscordStatusReadyListener(params) {
    return new (class DiscordStatusReadyListener extends ReadyListener {
        async handle(_data, client) {
            const autoPresenceController = params.getAutoPresenceController();
            if (autoPresenceController?.enabled) {
                autoPresenceController.refresh();
                return;
            }
            const gateway = client.getPlugin("gateway");
            if (!gateway) {
                return;
            }
            const presence = resolveDiscordPresenceUpdate(params.discordConfig);
            if (!presence) {
                return;
            }
            gateway.updatePresence(presence);
        }
    })();
}
export function createDiscordMonitorClient(params) {
    let autoPresenceController = null;
    const clientPlugins = [
        params.createGatewayPlugin({
            discordConfig: params.discordConfig,
            runtime: params.runtime,
        }),
    ];
    if (params.voiceEnabled) {
        clientPlugins.push(new VoicePlugin());
    }
    // Pass eventQueue config to Carbon so the gateway listener budget can be tuned.
    // Default listenerTimeout is 120s (Carbon defaults to 30s, which is too short for some
    // Discord normalization/enqueue work).
    const eventQueueOpts = {
        listenerTimeout: 120_000,
        ...params.discordConfig.eventQueue,
    };
    const readyListener = createDiscordStatusReadyListener({
        discordConfig: params.discordConfig,
        getAutoPresenceController: () => autoPresenceController,
    });
    const client = params.createClient({
        baseUrl: "http://localhost",
        deploySecret: "a",
        clientId: params.applicationId,
        publicKey: "a",
        token: params.token,
        autoDeploy: false,
        eventQueue: eventQueueOpts,
    }, {
        commands: params.commands,
        listeners: [readyListener],
        components: params.components,
        modals: params.modals,
    }, clientPlugins);
    const gateway = client.getPlugin("gateway");
    const gatewaySupervisor = params.createGatewaySupervisor({
        gateway,
        isDisallowedIntentsError: params.isDisallowedIntentsError,
        runtime: params.runtime,
    });
    if (gateway) {
        autoPresenceController = params.createAutoPresenceController({
            accountId: params.accountId,
            discordConfig: params.discordConfig,
            gateway,
            log: (message) => params.runtime.log?.(message),
        });
        autoPresenceController.start();
    }
    return {
        client,
        gateway,
        gatewaySupervisor,
        autoPresenceController,
        eventQueueOpts,
    };
}
export async function fetchDiscordBotIdentity(params) {
    params.logStartupPhase("fetch-bot-identity:start");
    try {
        const botUser = await params.client.fetchUser("@me");
        const botUserId = botUser?.id;
        const botUserName = botUser?.username?.trim() || botUser?.globalName?.trim() || undefined;
        params.logStartupPhase("fetch-bot-identity:done", `botUserId=${botUserId ?? "<missing>"} botUserName=${botUserName ?? "<missing>"}`);
        return { botUserId, botUserName };
    }
    catch (err) {
        params.runtime.error?.(danger(`discord: failed to fetch bot identity: ${String(err)}`));
        params.logStartupPhase("fetch-bot-identity:error", String(err));
        return { botUserId: undefined, botUserName: undefined };
    }
}
export function registerDiscordMonitorListeners(params) {
    registerDiscordListener(params.client.listeners, new DiscordMessageListener(params.messageHandler, params.logger, params.trackInboundEvent, {
        timeoutMs: params.eventQueueListenerTimeoutMs,
    }));
    const reactionListenerOptions = {
        cfg: params.cfg,
        accountId: params.accountId,
        runtime: params.runtime,
        botUserId: params.botUserId,
        dmEnabled: params.dmEnabled,
        groupDmEnabled: params.groupDmEnabled,
        groupDmChannels: params.groupDmChannels ?? [],
        dmPolicy: params.dmPolicy,
        allowFrom: params.allowFrom ?? [],
        groupPolicy: params.groupPolicy,
        allowNameMatching: isDangerousNameMatchingEnabled(params.discordConfig),
        guildEntries: params.guildEntries,
        logger: params.logger,
        onEvent: params.trackInboundEvent,
    };
    registerDiscordListener(params.client.listeners, new DiscordReactionListener(reactionListenerOptions));
    registerDiscordListener(params.client.listeners, new DiscordReactionRemoveListener(reactionListenerOptions));
    registerDiscordListener(params.client.listeners, new DiscordThreadUpdateListener(params.cfg, params.accountId, params.logger));
    if (params.discordConfig.intents?.presence) {
        registerDiscordListener(params.client.listeners, new DiscordPresenceListener({ logger: params.logger, accountId: params.accountId }));
        params.runtime.log?.("discord: GuildPresences intent enabled — presence listener registered");
    }
}
