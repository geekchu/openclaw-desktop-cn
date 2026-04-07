(function () {
  var TAG_NAME = "openclaw-config-channels";
  var OPEN_ALLOWLIST_CHANNELS = new Set([
    "telegram",
    "discord",
    "slack",
    "feishu",
    "imessage",
    "whatsapp",
  ]);
  var CHANNEL_ORDER = {
    wecom: 0,
    dingtalk: 1,
    feishu: 2,
    whatsapp: 3,
    discord: 4,
    slack: 5,
    imessage: 6,
    telegram: 7,
    qqbot: 8,
  };
  var EXTRA_FIELDS = {
    feishu: [
      {
        key: "testChatId",
        label: "测试 Chat ID",
        placeholder: "用于发送测试消息的 chat_id (可选)",
        insertIndex: 2,
      },
    ],
    imessage: [
      {
        key: "cliPath",
        label: "imsg 命令路径",
        placeholder: "本机 imsg 路径，或 SSH 包装脚本路径",
        insertIndex: 4,
      },
      {
        key: "remoteHost",
        label: "远程 Mac 主机",
        placeholder: "可选，如: user@mac-mini，用于远程附件拉取",
        insertIndex: 5,
      },
    ],
    dingtalk: [
      {
        key: "cardTemplateId",
        label: "卡片模板 ID",
        placeholder: "messageType=card 时必填",
        insertIndex: 5,
      },
      {
        key: "cardTemplateKey",
        label: "卡片内容字段",
        placeholder: "可选，默认 content",
        insertIndex: 6,
      },
    ],
  };
  var REQUIRED_FIELDS = {
    telegram: [{ key: "botToken", label: "Bot Token" }],
    discord: [{ key: "token", label: "Bot Token" }],
    slack: [{ key: "botToken", label: "Bot Token" }],
    feishu: [
      { key: "appId", label: "App ID" },
      { key: "appSecret", label: "App Secret" },
    ],
    wecom: [{ key: "token", label: "Token" }],
    dingtalk: [
      { key: "clientId", label: "Client ID" },
      { key: "clientSecret", label: "Client Secret" },
    ],
    qqbot: [
      { key: "appId", label: "App ID" },
      { key: "clientSecret", label: "App Secret" },
    ],
  };

  function getDefaultDmPolicy(channelType) {
    switch (channelType) {
      case "telegram":
      case "discord":
      case "slack":
      case "feishu":
      case "imessage":
      case "whatsapp":
        return "pairing";
      default:
        return null;
    }
  }

  function parseAllowlist(raw) {
    if (typeof raw !== "string") {
      return [];
    }
    return raw
      .split(",")
      .map(function (entry) {
        return entry.trim();
      })
      .filter(Boolean);
  }

  function normalizeFieldValue(value) {
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
    return "";
  }

  function currentChannel(instance, channelId, channelList) {
    var id = channelId || instance.selectedChannel;
    var list = channelList || instance.channels || [];
    return list.find(function (item) {
      return item.id === id;
    });
  }

  function currentRoot(instance) {
    return instance.renderRoot || instance.shadowRoot || null;
  }

  function setPatchedFieldValue(instance, key, value) {
    var nextForm = Object.assign({}, instance.configForm || {});
    nextForm[key] = value;
    instance.configForm = nextForm;

    var nextConfig = Object.assign({}, instance.selectedChannelConfig || {});
    if (value.trim() === "") {
      delete nextConfig[key];
    } else {
      nextConfig[key] = value;
    }
    instance.selectedChannelConfig = nextConfig;
  }

  function ensurePatchedField(instance, container, field) {
    var selector = '[data-legacy-patch-field="' + field.key + '"]';
    var wrapper = container.querySelector(selector);
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.className = "field";
      wrapper.setAttribute("data-legacy-patch-field", field.key);

      var label = document.createElement("label");
      label.className = "field-label";
      label.textContent = field.label;

      var indicator = document.createElement("span");
      indicator.className = "label-ok";
      indicator.style.marginLeft = "auto";
      indicator.textContent = "✓";
      label.appendChild(indicator);

      var input = document.createElement("input");
      input.type = "text";
      input.className = "input-base";
      input.setAttribute("data-legacy-patch-input", field.key);
      input.placeholder = field.placeholder;
      input.addEventListener("input", function () {
        setPatchedFieldValue(instance, field.key, input.value);
      });

      wrapper.appendChild(label);
      wrapper.appendChild(input);

      var children = Array.prototype.filter.call(container.children, function (node) {
        return node.nodeType === 1;
      });
      var anchor = children[field.insertIndex] || null;
      container.insertBefore(wrapper, anchor);
    }

    var inputEl = wrapper.querySelector('[data-legacy-patch-input="' + field.key + '"]');
    var labelOk = wrapper.querySelector(".label-ok");
    var value = (instance.configForm && instance.configForm[field.key]) || "";
    if (inputEl && inputEl.value !== value) {
      inputEl.value = value;
    }
    if (labelOk) {
      labelOk.style.display = value ? "" : "none";
    }
  }

  function patchRenderedFields(instance) {
    var channel = currentChannel(instance);
    var root = currentRoot(instance);
    if (!channel || !root) {
      return;
    }

    var titleSub = root.querySelector(".title-sub");
    if (channel.channel_type === "imessage" && titleSub) {
      titleSub.textContent = "支持本机 macOS，或通过 SSH 连接远程 Mac 上的 imsg";
    }

    var container = root.querySelector(".fields-container");
    if (!container) {
      return;
    }

    var extraFields = EXTRA_FIELDS[channel.channel_type] || [];
    for (var i = 0; i < extraFields.length; i += 1) {
      ensurePatchedField(instance, container, extraFields[i]);
    }

    if (channel.channel_type === "wecom") {
      var fieldLabels = root.querySelectorAll(".field-label");
      for (var j = 0; j < fieldLabels.length; j += 1) {
        var label = fieldLabels[j];
        if (!label.textContent || label.textContent.indexOf("EncodingAESKey") === -1) {
          continue;
        }
        var requiredMark = label.querySelector(".label-req");
        if (requiredMark) {
          requiredMark.remove();
        }
        var fieldRoot = label.closest(".field");
        var input = fieldRoot ? fieldRoot.querySelector("input") : null;
        if (input) {
          input.placeholder = "企业微信消息加密密钥 (可选，43位)";
        }
      }
    }
  }

  function validateConfigBeforeSave(channel, config) {
    var requiredFields = REQUIRED_FIELDS[channel.channel_type] || [];
    for (var i = 0; i < requiredFields.length; i += 1) {
      var field = requiredFields[i];
      if (
        channel.channel_type === "qqbot" &&
        field.key === "clientSecret" &&
        typeof config.clientSecretFile === "string" &&
        config.clientSecretFile.trim() !== ""
      ) {
        continue;
      }
      var value = config[field.key];
      if (value == null || typeof value !== "string" || value.trim() === "") {
        return field.label + " is required";
      }
    }

    var dmPolicy = typeof config.dmPolicy === "string" ? config.dmPolicy.trim() : "";
    var allowFrom = parseAllowlist(config.allowFrom);
    if (dmPolicy === "allowlist" && allowFrom.length === 0) {
      return "白名单模式需要配置私聊白名单";
    }
    if (
      dmPolicy === "open" &&
      OPEN_ALLOWLIST_CHANNELS.has(channel.channel_type) &&
      !allowFrom.includes("*")
    ) {
      return "开放模式需要在私聊白名单中添加 *";
    }

    if (channel.channel_type === "slack") {
      var mode =
        typeof config.mode === "string" && config.mode.trim() ? config.mode.trim() : "socket";
      if (!config.botToken || typeof config.botToken !== "string" || config.botToken.trim() === "") {
        return "Bot Token 为必填项";
      }
      if (mode === "http") {
        if (
          !config.signingSecret ||
          typeof config.signingSecret !== "string" ||
          config.signingSecret.trim() === ""
        ) {
          return "HTTP 模式需要配置 Signing Secret";
        }
      } else if (
        !config.appToken ||
        typeof config.appToken !== "string" ||
        config.appToken.trim() === ""
      ) {
        return "Socket 模式需要配置 App Token";
      }
    }

    if (channel.channel_type === "feishu") {
      var connectionMode =
        typeof config.connectionMode === "string" && config.connectionMode.trim()
          ? config.connectionMode.trim()
          : "websocket";
      if (connectionMode === "webhook") {
        if (
          !config.verificationToken ||
          typeof config.verificationToken !== "string" ||
          config.verificationToken.trim() === ""
        ) {
          return "Webhook 模式需要配置 Verification Token";
        }
        if (
          !config.encryptKey ||
          typeof config.encryptKey !== "string" ||
          config.encryptKey.trim() === ""
        ) {
          return "Webhook 模式需要配置 Encrypt Key";
        }
      }
    }

    if (channel.channel_type === "wecom") {
      var encodingAesKey =
        typeof config.encodingAesKey === "string" ? config.encodingAesKey.trim() : "";
      if (encodingAesKey !== "" && encodingAesKey.length !== 43) {
        return "EncodingAESKey 必须为 43 位";
      }
    }

    if (channel.channel_type === "dingtalk") {
      var messageType =
        typeof config.messageType === "string" && config.messageType.trim()
          ? config.messageType.trim()
          : "markdown";
      if (
        messageType === "card" &&
        (!config.cardTemplateId ||
          typeof config.cardTemplateId !== "string" ||
          config.cardTemplateId.trim() === "")
      ) {
        return "AI 卡片模式需要配置卡片模板 ID";
      }
    }

    return null;
  }

  function hasValidConfig(instance, channel) {
    var dmPolicy =
      typeof channel.config.dmPolicy === "string" && channel.config.dmPolicy.trim()
        ? channel.config.dmPolicy.trim()
        : getDefaultDmPolicy(channel.channel_type);
    var allowFrom = parseAllowlist(channel.config.allowFrom);

    if (dmPolicy === "allowlist" && allowFrom.length === 0) {
      return false;
    }
    if (
      dmPolicy === "open" &&
      OPEN_ALLOWLIST_CHANNELS.has(channel.channel_type) &&
      !allowFrom.includes("*")
    ) {
      return false;
    }

    if (channel.channel_type === "telegram") {
      return typeof channel.config.botToken === "string" && channel.config.botToken.trim() !== "";
    }

    if (channel.channel_type === "discord") {
      return typeof channel.config.token === "string" && channel.config.token.trim() !== "";
    }

    if (channel.channel_type === "slack") {
      var modeRaw = channel.config.mode;
      var mode = typeof modeRaw === "string" && modeRaw.trim() ? modeRaw.trim() : "socket";
      var hasBotToken =
        typeof channel.config.botToken === "string" && channel.config.botToken.trim() !== "";
      if (!hasBotToken) {
        return false;
      }
      if (mode === "http") {
        return (
          typeof channel.config.signingSecret === "string" &&
          channel.config.signingSecret.trim() !== ""
        );
      }
      return typeof channel.config.appToken === "string" && channel.config.appToken.trim() !== "";
    }

    if (channel.channel_type === "feishu") {
      if (
        typeof channel.config.appId !== "string" ||
        channel.config.appId.trim() === "" ||
        typeof channel.config.appSecret !== "string" ||
        channel.config.appSecret.trim() === ""
      ) {
        return false;
      }
      var connectionMode =
        typeof channel.config.connectionMode === "string" && channel.config.connectionMode.trim()
          ? channel.config.connectionMode.trim()
          : "websocket";
      if (connectionMode === "webhook") {
        return (
          typeof channel.config.verificationToken === "string" &&
          channel.config.verificationToken.trim() !== "" &&
          typeof channel.config.encryptKey === "string" &&
          channel.config.encryptKey.trim() !== ""
        );
      }
      return true;
    }

    if (channel.channel_type === "wecom") {
      var encodingAesKey = channel.config.encodingAesKey;
      return (
        typeof channel.config.token === "string" &&
        channel.config.token.trim() !== "" &&
        (encodingAesKey == null ||
          (typeof encodingAesKey === "string" &&
            (encodingAesKey.trim() === "" || encodingAesKey.trim().length === 43)))
      );
    }

    if (channel.channel_type === "dingtalk") {
      if (
        typeof channel.config.clientId !== "string" ||
        channel.config.clientId.trim() === "" ||
        typeof channel.config.clientSecret !== "string" ||
        channel.config.clientSecret.trim() === ""
      ) {
        return false;
      }
      var type =
        typeof channel.config.messageType === "string" && channel.config.messageType.trim()
          ? channel.config.messageType.trim()
          : "markdown";
      if (type === "card") {
        return (
          typeof channel.config.cardTemplateId === "string" &&
          channel.config.cardTemplateId.trim() !== ""
        );
      }
      return true;
    }

    if (channel.channel_type === "qqbot") {
      return (
        typeof channel.config.appId === "string" &&
        channel.config.appId.trim() !== "" &&
        ((typeof channel.config.clientSecret === "string" &&
          channel.config.clientSecret.trim() !== "") ||
          (typeof channel.config.clientSecretFile === "string" &&
            channel.config.clientSecretFile.trim() !== ""))
      );
    }

    var requiredFields = REQUIRED_FIELDS[channel.channel_type] || [];
    if (requiredFields.length === 0) {
      return channel.enabled;
    }
    return requiredFields.every(function (field) {
      var value = channel.config[field.key];
      return typeof value === "string" && value.trim() !== "";
    });
  }

  function patchConstructor(ctor) {
    if (!ctor || ctor.__legacyMessagesDesktopPatchApplied) {
      return;
    }

    var proto = ctor.prototype;
    var connectedText = String(proto.connectedCallback || "");
    var fetchText = String(proto.fetchChannels || "");
    var validateText = String(proto.validateConfigBeforeSave || "");
    var validText = String(proto.hasValidConfig || "");
    var staleRuntime =
      connectedText.indexOf("_loadAbort") === -1 ||
      fetchText.indexOf("telegram") === -1 ||
      fetchText.indexOf("qqbot") === -1 ||
      validateText.indexOf("clientSecretFile") === -1 ||
      validText.indexOf("cardTemplateId") === -1;

    if (!staleRuntime) {
      ctor.__legacyMessagesDesktopPatchApplied = true;
      return;
    }

    ctor.__legacyMessagesDesktopPatchApplied = true;

    var baseProto = Object.getPrototypeOf(proto);
    var baseConnectedCallback = baseProto && baseProto.connectedCallback;
    var baseDisconnectedCallback = baseProto && baseProto.disconnectedCallback;
    var originalFetchChannels = proto.fetchChannels;
    var originalHandleChannelSelect = proto.handleChannelSelect;
    var originalHandleSave = proto.handleSave;
    var originalUpdated = proto.updated;

    proto.connectedCallback = function () {
      if (typeof baseConnectedCallback === "function") {
        baseConnectedCallback.call(this);
      }
      this._loadAbort && this._loadAbort.abort();
      this._loadAbort = new AbortController();
      void this.init(this._loadAbort.signal);
    };

    proto.disconnectedCallback = function () {
      if (typeof baseDisconnectedCallback === "function") {
        baseDisconnectedCallback.call(this);
      }
      this._loadAbort && this._loadAbort.abort();
      this._loadAbort = null;
      if (this._whatsappPollTimer) {
        clearInterval(this._whatsappPollTimer);
        this._whatsappPollTimer = null;
      }
      if (this._whatsappTimeoutTimer) {
        clearTimeout(this._whatsappTimeoutTimer);
        this._whatsappTimeoutTimer = null;
      }
      if (typeof this._stopPairingPoll === "function") {
        this._stopPairingPoll();
      }
    };

    proto.fetchChannels = async function () {
      var result = await originalFetchChannels.call(this);
      if (!Array.isArray(result)) {
        return result;
      }
      result.sort(function (left, right) {
        var leftOrder =
          CHANNEL_ORDER[left.channel_type] === undefined ? 99 : CHANNEL_ORDER[left.channel_type];
        var rightOrder =
          CHANNEL_ORDER[right.channel_type] === undefined ? 99 : CHANNEL_ORDER[right.channel_type];
        return leftOrder - rightOrder;
      });
      this.channels = result;
      return result;
    };

    proto.init = async function (signal) {
      this.loading = true;
      if (signal && signal.aborted) {
        this.loading = false;
        return;
      }
      try {
        var result = await this.fetchChannels();
        if (signal && signal.aborted) {
          return;
        }
        var configured = Array.isArray(result)
          ? result.find(function (item) {
              return item.enabled;
            })
          : null;
        if (configured) {
          this.handleChannelSelect(configured.id, result);
        } else if (Array.isArray(result) && result.length > 0) {
          this.handleChannelSelect(result[0].id, result);
        }
      } finally {
        this.loading = false;
      }
    };

    proto.handleChannelSelect = function (channelId, channelList) {
      originalHandleChannelSelect.call(this, channelId, channelList);
      var channel = currentChannel(this, channelId, channelList);
      if (!channel) {
        return;
      }

      var nextForm = Object.assign({}, this.configForm || {});
      var extraFields = EXTRA_FIELDS[channel.channel_type] || [];
      var changed = false;
      for (var i = 0; i < extraFields.length; i += 1) {
        var field = extraFields[i];
        var normalized = normalizeFieldValue(channel.config && channel.config[field.key]);
        if (nextForm[field.key] !== normalized) {
          nextForm[field.key] = normalized;
          changed = true;
        }
      }

      if (changed) {
        this.configForm = nextForm;
      }
    };

    proto.validateConfigBeforeSave = function (channel, config) {
      return validateConfigBeforeSave(channel, config);
    };

    proto.handleSave = async function () {
      var channel = currentChannel(this);
      if (!channel) {
        return originalHandleSave.call(this);
      }

      var patchedConfig = Object.assign({}, this.selectedChannelConfig || {});
      var extraFields = EXTRA_FIELDS[channel.channel_type] || [];
      for (var i = 0; i < extraFields.length; i += 1) {
        var key = extraFields[i].key;
        var raw = (this.configForm && this.configForm[key]) || "";
        if (raw.trim() === "") {
          delete patchedConfig[key];
        } else {
          patchedConfig[key] = raw.trim();
        }
      }

      this.selectedChannelConfig = patchedConfig;
      return originalHandleSave.call(this);
    };

    proto.hasValidConfig = function (channel) {
      return hasValidConfig(this, channel);
    };

    proto.updated = function (changedProperties) {
      if (typeof originalUpdated === "function") {
        originalUpdated.call(this, changedProperties);
      }
      patchRenderedFields(this);
    };

    var existing = document.querySelectorAll(TAG_NAME);
    for (var i = 0; i < existing.length; i += 1) {
      var element = existing[i];
      if (!element.isConnected) {
        continue;
      }
      element._loadAbort && element._loadAbort.abort();
      element._loadAbort = new AbortController();
      void element.init(element._loadAbort.signal);
    }
  }

  function applyPatch() {
    patchConstructor(customElements.get(TAG_NAME));
  }

  if (customElements.get(TAG_NAME)) {
    applyPatch();
  } else {
    customElements.whenDefined(TAG_NAME).then(applyPatch);
  }
})();
