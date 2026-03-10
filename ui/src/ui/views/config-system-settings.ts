/**
 * 系统设置 — native Lit port of openclaw-manager Settings component.
 *
 * Visual style matches the React-based Channels Config page (inside the manager iframe)
 * using the same design tokens mapped from --mg-* to WebUI CSS variables.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { checkForUpdate, downloadUpdate, installUpdate } from "./updater.js";

export const CLAW_CONFIG_SYSTEM = "claw-config-system";
/* ── tiny Tauri invoke helper ─────────────────────────────── */
function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = (window as any).__TAURI__;
  if (t?.core?.invoke) {
    return t.core.invoke(cmd, args) as Promise<T>;
  }
  return Promise.reject(new Error("Tauri invoke not available"));
}

/* ── helpers ──────────────────────────────────────────────── */
function getNestedValue(obj: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
function ensurePath(obj: Record<string, unknown>, path: string[]) {
  let cur = obj;
  for (const k of path) {
    if (cur[k] == null || typeof cur[k] !== "object") {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
}

/* ── component ────────────────────────────────────────────── */
@customElement("openclaw-system-settings")
export class SystemSettingsView extends LitElement {
  @state() private loading = true;
  @state() private saving = false;
  @state() private saveStatus: "idle" | "success" | "error" = "idle";

  @state() private execSecurity: "allowlist" | "deny" | "full" = "allowlist";
  @state() private execAsk: "off" | "on-miss" | "always" = "on-miss";
  @state() private toolProfile: "minimal" | "coding" | "messaging" | "full" = "full";
  @state() private fsWorkspaceOnly = false;
  @state() private fsAllowedDirs: string[] = [];
  @state() private allowlistEntries: Array<{
    id?: string;
    pattern: string;
    lastUsedCommand?: string;
  }> = [];
  private _execApprovalsData: Record<string, unknown> | null = null;

  @state() private botName = "Clawd";
  @state() private userName = "主人";
  @state() private timezone = "Asia/Shanghai";
  @state() private autoStart = false;
  @state() private autoStartBusy = false;
  @state() private lanAccess = false;
  @state() private lanAccessBusy = false;
  @state() private gatewayToken = "";

  /* ── update states ── */
  @state() private updateChecking = false;
  @state() private updateAvailable = false;
  @state() private updateVersion = "";
  @state() private updateNotes = "";
  @state() private updateDownloading = false;
  @state() private updateProgress = 0;
  @state() private updateError = "";
  @state() private updateDone = false;
  @state() private updateInstalled = false;
  private _updateRid: number | null = null;
  private _downloadedBytesRid: number | null = null;

  /* ── lifecycle ── */
  override connectedCallback() {
    super.connectedCallback();
    this._loadConfig();
  }

  private async _loadConfig() {
    this.loading = true;
    try {
      const cfg = (await invoke<Record<string, unknown>>("get_config")) ?? {};
      const secMode = getNestedValue(cfg, ["tools", "exec", "security"]);
      if (secMode === "deny" || secMode === "allowlist" || secMode === "full") {
        this.execSecurity = secMode;
      }
      const askMode = getNestedValue(cfg, ["tools", "exec", "ask"]);
      if (askMode === "off" || askMode === "on-miss" || askMode === "always") {
        this.execAsk = askMode;
      }
      const profile = getNestedValue(cfg, ["tools", "profile"]);
      if (
        profile === "minimal" ||
        profile === "coding" ||
        profile === "messaging" ||
        profile === "full"
      ) {
        this.toolProfile = profile;
      }
      const fsMode = getNestedValue(cfg, ["tools", "fs", "workspaceOnly"]);
      if (typeof fsMode === "boolean") {
        this.fsWorkspaceOnly = fsMode;
      }
      const fsDirs = getNestedValue(cfg, ["tools", "fs", "allowedDirs"]);
      if (Array.isArray(fsDirs)) {
        this.fsAllowedDirs = fsDirs.filter((f) => typeof f === "string");
      }
      try {
        const desktop = (await invoke<Record<string, unknown>>("get_desktop_config")) ?? {};
        const ident = desktop.identity as Record<string, unknown> | undefined;
        if (ident) {
          this.botName = (ident.botName as string) || "Clawd";
          this.userName = (ident.userName as string) || "主人";
          this.timezone = (ident.timezone as string) || "Asia/Shanghai";
        }
        // 加载局域网访问设置
        if (typeof desktop.lanAccess === "boolean") {
          this.lanAccess = desktop.lanAccess;
        }
      } catch {
        /* ignore */
      }
      // 加载 gateway token
      const gatewayToken = getNestedValue(cfg, ["gateway", "auth", "token"]);
      if (typeof gatewayToken === "string") {
        this.gatewayToken = gatewayToken;
      }
      try {
        this.autoStart = await invoke<boolean>("autostart_is_enabled");
      } catch {
        /* ignore */
      }
      try {
        const approvals = (await invoke<Record<string, unknown>>("get_exec_approvals")) ?? {};
        this._execApprovalsData = approvals;
        const agents = (approvals.agents ?? {}) as Record<string, Record<string, unknown>>;
        const mainAgent = agents.main ?? {};
        const allowlist = Array.isArray(mainAgent.allowlist) ? mainAgent.allowlist : [];
        this.allowlistEntries = allowlist
          .filter(
            (e: unknown): e is Record<string, unknown> =>
              !!e &&
              typeof e === "object" &&
              typeof (e as Record<string, unknown>).pattern === "string",
          )
          .map((e: Record<string, unknown>) => ({
            id: e.id as string | undefined,
            pattern: e.pattern as string,
            lastUsedCommand: e.lastUsedCommand as string | undefined,
          }));
      } catch {
        /* ignore */
      }
    } catch (e) {
      console.error("加载配置失败:", e);
    } finally {
      this.loading = false;
    }
  }

  /* ── save ── */
  private _securityTimer?: ReturnType<typeof setTimeout>;
  private _askTimer?: ReturnType<typeof setTimeout>;
  private _profileTimer?: ReturnType<typeof setTimeout>;
  private _saveQueue: Promise<void> = Promise.resolve();

  private _saveField(path: string[], key: string, value: unknown) {
    // 串行化：每次 _saveField 排队执行，避免并发 read-modify-write 竞态
    this._saveQueue = this._saveQueue.then(async () => {
      try {
        const cfg = (await invoke<Record<string, unknown>>("get_config")) ?? {};
        ensurePath(cfg, path);
        (getNestedValue(cfg, path) as Record<string, unknown>)[key] = value;
        await invoke("save_config", { config: cfg });
      } catch (e) {
        console.error("保存失败:", e);
      }
    });
  }

  private _handleSecurityChange(mode: typeof this.execSecurity) {
    if (mode === this.execSecurity) {
      return;
    }
    this.execSecurity = mode;
    clearTimeout(this._securityTimer);
    // 切换到非 allowlist 模式时，取消待执行的 ask 保存定时器
    if (mode !== "allowlist") {
      clearTimeout(this._askTimer);
    }
    this._securityTimer = setTimeout(
      () => this._saveField(["tools", "exec"], "security", mode),
      300,
    );
  }
  private _handleAskChange(mode: typeof this.execAsk) {
    if (mode === this.execAsk) {
      return;
    }
    this.execAsk = mode;
    clearTimeout(this._askTimer);
    this._askTimer = setTimeout(() => this._saveField(["tools", "exec"], "ask", mode), 300);
  }
  private _handleProfileChange(profile: typeof this.toolProfile) {
    if (profile === this.toolProfile) {
      return;
    }
    this.toolProfile = profile;
    clearTimeout(this._profileTimer);
    this._profileTimer = setTimeout(() => this._saveField(["tools"], "profile", profile), 300);
  }
  private _fsTimer?: ReturnType<typeof setTimeout>;
  private _handleFsChange(workspaceOnly: boolean) {
    if (workspaceOnly === this.fsWorkspaceOnly) {
      return;
    }
    this.fsWorkspaceOnly = workspaceOnly;
    clearTimeout(this._fsTimer);
    this._fsTimer = setTimeout(
      () => this._saveField(["tools", "fs"], "workspaceOnly", workspaceOnly),
      300,
    );
  }

  private async _handleAddAllowedDir() {
    try {
      const folder = await invoke<string | null>("pick_folder");
      if (folder) {
        // 避免重复添加相同的路径
        if (!this.fsAllowedDirs.includes(folder)) {
          this.fsAllowedDirs = [...this.fsAllowedDirs, folder];
          this._triggerDirsSave();
        }
      }
    } catch (e) {
      console.error("选择目录失败:", e);
    }
  }

  private _handleRemoveAllowedDir(index: number) {
    const next = [...this.fsAllowedDirs];
    next.splice(index, 1);
    this.fsAllowedDirs = next;
    this._triggerDirsSave();
  }

  private async _handleRemoveAllowlistEntry(index: number) {
    const removed = this.allowlistEntries[index];
    if (!removed) {
      return;
    }
    const next = [...this.allowlistEntries];
    next.splice(index, 1);
    this.allowlistEntries = next;
    // Read-modify-write: re-read the file to avoid overwriting concurrent gateway changes
    try {
      const freshData = (await invoke<Record<string, unknown>>("get_exec_approvals")) ?? {};
      const agents = { ...((freshData.agents ?? {}) as Record<string, Record<string, unknown>>) };
      const mainAgent = { ...agents.main };
      const currentList = Array.isArray(mainAgent.allowlist)
        ? ([...mainAgent.allowlist] as Array<Record<string, unknown>>)
        : [];
      // Remove by id if available, otherwise by pattern
      const matchIdx = currentList.findIndex((e) =>
        removed.id ? e.id === removed.id : e.pattern === removed.pattern,
      );
      if (matchIdx >= 0) {
        currentList.splice(matchIdx, 1);
      }
      mainAgent.allowlist = currentList;
      agents.main = mainAgent;
      freshData.agents = agents;
      await invoke("save_exec_approvals", { data: freshData });
      this._execApprovalsData = freshData;
    } catch (e) {
      console.error("删除白名单条目失败:", e);
    }
  }

  private _dirsTimer?: ReturnType<typeof setTimeout>;
  private _triggerDirsSave() {
    clearTimeout(this._dirsTimer);
    this._dirsTimer = setTimeout(() => {
      const valid = this.fsAllowedDirs.map((d) => d.trim()).filter((d) => d.length > 0);
      this._saveField(["tools", "fs"], "allowedDirs", valid);
    }, 500);
  }

  private async _handleSaveIdentity() {
    this.saving = true;
    this.saveStatus = "idle";
    try {
      await invoke("save_desktop_config", {
        config: {
          identity: { botName: this.botName, userName: this.userName, timezone: this.timezone },
        },
      });
      this.saveStatus = "success";
      setTimeout(() => (this.saveStatus = "idle"), 2000);
    } catch (e) {
      console.error("保存失败:", e);
      this.saveStatus = "error";
      setTimeout(() => (this.saveStatus = "idle"), 3000);
    } finally {
      this.saving = false;
    }
  }

  private async _toggleAutoStart() {
    if (this.autoStartBusy) {
      return;
    }
    this.autoStartBusy = true;
    try {
      if (this.autoStart) {
        await invoke("autostart_disable");
        this.autoStart = false;
      } else {
        await invoke("autostart_enable");
        this.autoStart = true;
      }
    } catch (e) {
      console.error("切换开机自启失败:", e);
    } finally {
      this.autoStartBusy = false;
    }
  }

  private async _toggleLanAccess() {
    if (this.lanAccessBusy) {
      return;
    }
    this.lanAccessBusy = true;
    try {
      const newValue = !this.lanAccess;
      await invoke("save_desktop_config", { config: { lanAccess: newValue } });
      this.lanAccess = newValue;
      // 提示用户需要重启
      const modeName = newValue ? "局域网访问" : "仅本地访问";
      if (confirm(`已切换到「${modeName}」模式，需要重启应用才能生效。\n\n是否立即重启？`)) {
        const t = (window as any).__TAURI__;
        if (t?.core?.invoke) {
          try {
            await t.core.invoke("stop_gateway");
          } catch { /* best-effort */ }
          t.core.invoke("plugin:process|restart");
        }
      }
    } catch (e) {
      console.error("切换局域网访问失败:", e);
    } finally {
      this.lanAccessBusy = false;
    }
  }

  private async _copyGatewayToken() {
    if (!this.gatewayToken) return;
    try {
      await navigator.clipboard.writeText(this.gatewayToken);
      // 简单的复制成功提示
      const btn = this.shadowRoot?.querySelector(".copy-token-btn") as HTMLElement | null;
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = "已复制";
        setTimeout(() => {
          btn.textContent = originalText;
        }, 1500);
      }
    } catch (e) {
      console.error("复制失败:", e);
    }
  }

  private async _openConfigDir() {
    try {
      await invoke("open_config_dir");
    } catch (e) {
      console.error("打开目录失败:", e);
    }
  }

  /* ───────────────────────────────────────────────
     CSS — matches the React Channels page visual style
     ─────────────────────────────────────────────── */
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      color: var(--text, #e4e4e7);
      font-family: var(--font-body, "Space Grotesk", system-ui, sans-serif);
      overflow: hidden;
    }

    /* ── header (same as channels embed header) ── */
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 24px;
      border-bottom: 1px solid var(--border, #27272a);
      flex-shrink: 0;
    }
    .header-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .header-icon svg {
      width: 18px;
      height: 18px;
      color: white;
    }
    .header-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-strong, #fafafa);
    }
    .header-sub {
      font-size: 12px;
      color: var(--muted, #71717a);
    }

    /* ── scrollable content (matches channels p-4) ── */
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }

    /* ── card (matches channels bg-dark-700 rounded-2xl p-6 border border-dark-500) ── */
    .card {
      background: var(--bg-elevated, #1a1d25);
      border: 1px solid var(--border, #27272a);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
    }
    .card:last-child {
      margin-bottom: 0;
    }

    /* ── card title (matches channels h3) ── */
    .card-title {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    .card-title-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .card-title-icon.amber {
      background: rgba(245, 158, 11, 0.15);
    }
    .card-title-icon.blue {
      background: rgba(59, 130, 246, 0.15);
    }
    .card-title-icon.gray {
      background: rgba(113, 113, 122, 0.15);
    }
    .card-title-icon svg {
      width: 20px;
      height: 20px;
    }
    .card-title-icon.amber svg {
      color: var(--warn, #f59e0b);
    }
    .card-title-icon.blue svg {
      color: var(--info, #3b82f6);
    }
    .card-title-icon.gray svg {
      color: var(--muted, #71717a);
    }
    .title-text {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-strong, #fafafa);
    }
    .title-sub {
      font-size: 12px;
      color: var(--muted, #71717a);
      margin-top: 2px;
    }

    /* ── section (inside card, with opt buttons) ── */
    .section {
      margin-bottom: 16px;
    }
    .section:last-child {
      margin-bottom: 0;
    }
    .section-label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: var(--muted, #71717a);
      margin-bottom: 8px;
    }
    .section-hint {
      font-size: 12px;
      color: var(--muted, #71717a);
      margin-top: 2px;
    }

    /* ── option buttons (matches channels button patterns) ── */
    .btn-group {
      display: grid;
      gap: 8px;
      margin-top: 8px;
    }
    .btn-group.g3 {
      grid-template-columns: repeat(3, 1fr);
    }
    .btn-group.g4 {
      grid-template-columns: repeat(4, 1fr);
    }

    .opt {
      padding: 10px 8px;
      border-radius: 12px;
      border: 1px solid var(--border, #27272a);
      background: var(--card, #181b22);
      color: var(--muted, #71717a);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      text-align: center;
      transition: all 0.15s ease;
      line-height: 1.35;
    }
    .opt:hover {
      background: var(--bg-hover, #262a35);
      border-color: var(--border-strong, #3f3f46);
    }
    .opt.on-red {
      background: rgba(239, 68, 68, 0.12);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.35);
    }
    .opt.on-amber {
      background: rgba(245, 158, 11, 0.12);
      color: #fbbf24;
      border-color: rgba(245, 158, 11, 0.35);
    }
    .opt.on-green {
      background: rgba(34, 197, 94, 0.12);
      color: #4ade80;
      border-color: rgba(34, 197, 94, 0.35);
    }
    .opt.on-blue {
      background: rgba(59, 130, 246, 0.12);
      color: #60a5fa;
      border-color: rgba(59, 130, 246, 0.35);
    }
    .opt-sub {
      font-size: 10px;
      opacity: 0.5;
      margin-top: 2px;
    }

    /* ── form fields (matches channels input-base) ── */
    .field {
      margin-bottom: 16px;
    }
    .field:last-child {
      margin-bottom: 0;
    }
    .field-label {
      display: block;
      font-size: 14px;
      color: var(--muted, #71717a);
      margin-bottom: 8px;
    }
    .input-base {
      width: 100%;
      padding: 10px 14px;
      border-radius: 12px;
      border: 1px solid var(--border, #27272a);
      background: var(--bg-elevated, #1a1d25);
      color: var(--text, #e4e4e7);
      font-size: 14px;
      outline: none;
      box-sizing: border-box;
      transition:
        border-color 0.15s ease,
        box-shadow 0.15s ease;
      font-family: inherit;
    }
    .input-base:focus {
      border-color: var(--accent, #ff5c5c);
      box-shadow:
        0 0 0 2px var(--panel, #12141a),
        0 0 0 4px var(--ring, #ff5c5c);
    }
    .input-base::placeholder {
      color: var(--muted, #71717a);
    }

    /* ── toggle row (matches channels channel-item pattern) ── */
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      background: var(--card, #181b22);
      border: 1px solid var(--border, #27272a);
      border-radius: 12px;
      margin-bottom: 8px;
    }
    .toggle-row:last-child {
      margin-bottom: 0;
    }
    .toggle-row-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .toggle-row-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: var(--bg-hover, #262a35);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }
    .toggle-text-primary {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-strong, #fafafa);
    }
    .toggle-text-secondary {
      font-size: 12px;
      color: var(--muted, #71717a);
      margin-top: 2px;
    }

    /* ── switch ── */
    .switch {
      position: relative;
      width: 44px;
      height: 24px;
      flex-shrink: 0;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .switch-track {
      position: absolute;
      inset: 0;
      background: var(--bg-hover, #262a35);
      border-radius: 24px;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .switch-track::before {
      content: "";
      position: absolute;
      width: 20px;
      height: 20px;
      left: 2px;
      bottom: 2px;
      background: white;
      border-radius: 50%;
      transition: transform 0.15s ease;
    }
    .switch input:checked + .switch-track {
      background: var(--accent, #ff5c5c);
    }
    .switch input:checked + .switch-track::before {
      transform: translateX(20px);
    }

    /* ── clickable row ── */
    .click-row {
      display: flex;
      align-items: center;
      width: 100%;
      padding: 16px;
      background: var(--card, #181b22);
      border: 1px solid var(--border, #27272a);
      border-radius: 12px;
      color: inherit;
      cursor: pointer;
      text-align: left;
      font: inherit;
      transition:
        background 0.15s ease,
        border-color 0.15s ease;
    }
    .click-row:hover {
      background: var(--bg-hover, #262a35);
      border-color: var(--border-strong, #3f3f46);
    }
    .click-row .chevron {
      margin-left: auto;
      color: var(--muted, #71717a);
    }
    .click-row .chevron svg {
      width: 16px;
      height: 16px;
    }

    /* ── buttons (matches channels btn-primary) ── */
    .btn-primary {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 12px;
      border: none;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      background: var(--accent, #ff5c5c);
      color: white;
      transition: all 0.15s ease;
      font-family: inherit;
    }
    .btn-primary:hover {
      opacity: 0.9;
    }
    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* ── action bar (matches channels pt-4 border-t) ── */
    .action-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-top: 16px;
      border-top: 1px solid var(--border, #27272a);
      margin-top: 16px;
    }
    .save-msg {
      font-size: 14px;
      margin-left: auto;
    }
    .save-msg.ok {
      color: #4ade80;
    }
    .save-msg.err {
      color: #f87171;
    }

    /* ── loading ── */
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 60px 0;
      color: var(--muted, #71717a);
      font-size: 14px;
      gap: 8px;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    .spinner-sm {
      width: 14px;
      height: 14px;
      border-width: 1.5px;
    }

    /* ── update card ── */
    .update-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 0 4px;
    }
    .update-info {
      flex: 1;
      padding-right: 16px;
    }
    .update-progress-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 8px;
    }
    .update-progress-bar {
      flex: 1;
      height: 6px;
      background: var(--mg-border, rgba(255, 255, 255, 0.08));
      border-radius: 3px;
      overflow: hidden;
    }
    .update-progress-fill {
      height: 100%;
      background: var(--info, #3b82f6);
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .update-progress-pct {
      font-size: 12px;
      font-weight: 600;
      color: var(--mg-text-secondary, #8b949e);
      min-width: 36px;
      text-align: right;
    }
    .update-error {
      font-size: 13px;
      color: var(--danger, #f85149);
      margin-top: 6px;
    }
  `;

  /* ── SVG icons ── */
  private _settingsIcon = html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
      ></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
  private _shieldIcon = html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
    </svg>
  `;
  private _userIcon = html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>
  `;
  private _cpuIcon = html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="4" y="4" width="16" height="16" rx="2"></rect>
      <rect x="9" y="9" width="6" height="6"></rect>
      <path d="M15 2v2"></path>
      <path d="M15 20v2"></path>
      <path d="M2 15h2"></path>
      <path d="M2 9h2"></path>
      <path d="M20 15h2"></path>
      <path d="M20 9h2"></path>
      <path d="M9 2v2"></path>
      <path d="M9 20v2"></path>
    </svg>
  `;
  private _chevronRight = html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m9 18 6-6-6-6" />
    </svg>
  `;

  /* ── render ── */
  override render() {
    if (this.loading) {
      return html`
        ${this._renderHeader()}
        <div class="loading"><span class="spinner"></span>加载配置中…</div>
      `;
    }

    return html`
      ${this._renderHeader()}
      <div class="content">
        ${this._renderSecurityCard()}
        ${this._renderIdentityCard()}
        ${this._renderAdvancedCard()}
        ${this._renderUpdateCard()}
      </div>
    `;
  }

  private _renderHeader() {
    return html`
      <div class="header">
        <div class="header-icon">${this._settingsIcon}</div>
        <div>
          <div class="header-title">系统设置</div>
          <div class="header-sub">配置身份、安全和系统选项</div>
        </div>
      </div>`;
  }

  private _renderSecurityCard() {
    return html`
      <div class="card">
        <div class="card-title">
          <div class="card-title-icon amber">${this._shieldIcon}</div>
          <div>
            <div class="title-text">安全设置</div>
            <div class="title-sub">AI 代理权限与工具访问控制</div>
          </div>
        </div>

        <div class="section">
          <label class="section-label">
            执行安全模式
            <span class="section-hint">&nbsp;— 控制 AI 执行命令的权限级别</span>
          </label>
          <div class="btn-group g3">
            <button class="opt ${this.execSecurity === "deny" ? "on-red" : ""}" @click=${() => this._handleSecurityChange("deny")}>
              <div>禁止执行</div><div class="opt-sub">deny</div>
            </button>
            <button class="opt ${this.execSecurity === "allowlist" ? "on-amber" : ""}" @click=${() => this._handleSecurityChange("allowlist")}>
              <div>白名单</div><div class="opt-sub">allowlist</div>
            </button>
            <button class="opt ${this.execSecurity === "full" ? "on-green" : ""}" @click=${() => this._handleSecurityChange("full")}>
              <div>完全放开</div><div class="opt-sub">full</div>
            </button>
          </div>
        </div>

        ${
          this.execSecurity === "allowlist"
            ? html`
          <div class="section">
            <label class="section-label">
              命令审批
              <span class="section-hint">&nbsp;— 未知命令的处理方式</span>
            </label>
            <div class="btn-group g3">
              <button class="opt ${this.execAsk === "always" ? "on-red" : ""}" @click=${() => this._handleAskChange("always")}>
                <div>每次确认</div><div class="opt-sub">always</div>
              </button>
              <button class="opt ${this.execAsk === "on-miss" ? "on-amber" : ""}" @click=${() => this._handleAskChange("on-miss")}>
                <div>未知时确认</div><div class="opt-sub">on-miss</div>
              </button>
              <button class="opt ${this.execAsk === "off" ? "on-green" : ""}" @click=${() => this._handleAskChange("off")}>
                <div>无需确认</div><div class="opt-sub">off</div>
              </button>
            </div>
          </div>
        `
            : nothing
        }

        ${
          this.execSecurity === "allowlist"
            ? html`
          <div class="section">
            <label class="section-label">
              命令白名单
              <span class="section-hint">&nbsp;— 已批准的可执行程序路径</span>
            </label>
            <div style="margin-top: 4px; padding: 12px 14px; background: var(--bg-elevated, #1a1d25); border: 1px solid var(--border, #27272a); border-radius: 10px; max-height: 300px; overflow-y: auto;">
              ${
                this.allowlistEntries.length === 0
                  ? html`
                      <div
                        style="
                          font-size: 12px;
                          color: var(--muted, #71717a);
                          text-align: center;
                          padding: 12px 0;
                          border: 1px dashed var(--border, #27272a);
                          border-radius: 8px;
                          opacity: 0.7;
                        "
                      >
                        暂无白名单条目，点击"始终允许"后自动添加
                      </div>
                    `
                  : html`
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px; max-width: 960px;">
                  ${this.allowlistEntries.map((entry, idx) => {
                    // Show the executable name as primary, full path as tooltip
                    const parts = entry.pattern.replace(/\\/g, "/").split("/");
                    const exeName = parts[parts.length - 1] || entry.pattern;
                    return html`
                      <div style="
                        display: flex; align-items: center; gap: 8px;
                        padding: 6px 10px;
                        background: var(--card, #181b22);
                        border: 1px solid var(--border, #27272a);
                        border-radius: 8px; font-size: 12px;
                        color: var(--text, #e4e4e7);
                      " title=${entry.pattern}>
                        <span style="flex-shrink: 0; font-size: 13px;">⚙️</span>
                        <div style="flex: 1; min-width: 0; overflow: hidden;">
                          <div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${exeName}</div>
                          <div style="font-size: 11px; color: var(--muted, #71717a); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;">${entry.pattern}</div>
                        </div>
                        <button @click=${() => this._handleRemoveAllowlistEntry(idx)}
                          style="
                            display: inline-flex; align-items: center; justify-content: center;
                            width: 22px; height: 22px; border-radius: 50%;
                            background: transparent; border: 1px solid var(--border, #27272a);
                            color: var(--muted, #71717a); cursor: pointer;
                            font-size: 11px; line-height: 1; padding: 0;
                            flex-shrink: 0; transition: all 0.15s ease;
                          "
                          @mouseover=${(e: Event) => {
                            (e.target as HTMLElement).style.background = "rgba(239,68,68,0.15)";
                            (e.target as HTMLElement).style.color = "#ef4444";
                            (e.target as HTMLElement).style.borderColor = "#ef4444";
                          }}
                          @mouseout=${(e: Event) => {
                            (e.target as HTMLElement).style.background = "transparent";
                            (e.target as HTMLElement).style.color = "var(--muted, #71717a)";
                            (e.target as HTMLElement).style.borderColor = "var(--border, #27272a)";
                          }}
                          title="移除此白名单条目"
                        >✕</button>
                      </div>
                    `;
                  })}
                </div>
              `
              }
            </div>
          </div>
        `
            : nothing
        }

        <div class="section">
          <label class="section-label">
            工具预设
            <span class="section-hint">&nbsp;— 控制 AI 可使用的工具范围</span>
          </label>
          <div class="btn-group g4">
            <button class="opt ${this.toolProfile === "minimal" ? "on-red" : ""}" @click=${() => this._handleProfileChange("minimal")}>
              <div>最小</div><div class="opt-sub">minimal</div>
            </button>
            <button class="opt ${this.toolProfile === "coding" ? "on-blue" : ""}" @click=${() => this._handleProfileChange("coding")}>
              <div>编程</div><div class="opt-sub">coding</div>
            </button>
            <button class="opt ${this.toolProfile === "messaging" ? "on-amber" : ""}" @click=${() => this._handleProfileChange("messaging")}>
              <div>消息</div><div class="opt-sub">messaging</div>
            </button>
            <button class="opt ${this.toolProfile === "full" ? "on-green" : ""}" @click=${() => this._handleProfileChange("full")}>
              <div>全部</div><div class="opt-sub">full</div>
            </button>
          </div>
        </div>

        <div class="section">
          <label class="section-label">
            文件访问控制
            <span class="section-hint">&nbsp;— 限制 AI 可访问的文件目录范围</span>
          </label>

          <div class="toggle-row">
            <div class="toggle-row-info">
              <div class="toggle-row-icon">📁</div>
              <div>
                <div class="toggle-text-primary">限制文件访问</div>
                <div class="toggle-text-secondary">开启后 AI 仅能访问工作区及下方指定的目录</div>
              </div>
            </div>
            <label class="switch">
              <input type="checkbox" .checked=${this.fsWorkspaceOnly} @change=${(e: Event) => this._handleFsChange((e.target as HTMLInputElement).checked)} />
              <span class="switch-track"></span>
            </label>
          </div>

          ${
            this.fsWorkspaceOnly
              ? html`
            <div style="margin-top: 10px; padding: 12px 14px; background: var(--bg-elevated, #1a1d25); border: 1px solid var(--border, #27272a); border-radius: 10px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <div style="font-size: 12px; color: var(--muted, #71717a); font-weight: 500;">允许访问的额外目录</div>
                <button class="opt" style="padding: 4px 10px; font-size: 11px; white-space: nowrap; border-radius: 12px;" @click=${this._handleAddAllowedDir}>+ 添加目录</button>
              </div>
              ${
                this.fsAllowedDirs.length === 0
                  ? html`
                      <div
                        style="
                          font-size: 12px;
                          color: var(--muted, #71717a);
                          text-align: center;
                          padding: 12px 0;
                          border: 1px dashed var(--border, #27272a);
                          border-radius: 8px;
                          opacity: 0.7;
                        "
                      >
                        AI 当前仅能访问工作区目录
                      </div>
                    `
                  : html`
                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                  ${this.fsAllowedDirs.map(
                    (dir, idx) => html`
                    <span style="
                      display: inline-flex; align-items: center; gap: 5px;
                      padding: 5px 8px 5px 10px;
                      background: var(--card, #181b22);
                      border: 1px solid var(--border, #27272a);
                      border-radius: 20px; font-size: 12px;
                      color: var(--text, #e4e4e7);
                      max-width: 300px; cursor: default;
                    " title=${dir}>
                      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.85;">📂 ${dir}</span>
                      <button @click=${() => this._handleRemoveAllowedDir(idx)}
                        style="
                          display: inline-flex; align-items: center; justify-content: center;
                          width: 16px; height: 16px; border-radius: 50%;
                          background: transparent; border: none;
                          color: var(--muted, #71717a); cursor: pointer;
                          font-size: 10px; line-height: 1; padding: 0;
                          flex-shrink: 0;
                        "
                        title="移除目录"
                      >✕</button>
                    </span>
                  `,
                  )}
                </div>
              `
              }
            </div>
          `
              : nothing
          }
        </div>

        <div class="section">
          <label class="section-label">
            网络访问
            <span class="section-hint">&nbsp;— 控制 Gateway 服务的网络监听范围</span>
          </label>

          <div class="toggle-row">
            <div class="toggle-row-info">
              <div class="toggle-row-icon">🌐</div>
              <div>
                <div class="toggle-text-primary">开放局域网访问</div>
                <div class="toggle-text-secondary">允许局域网内其他设备连接 Gateway（需重启生效）</div>
              </div>
            </div>
            <label class="switch">
              <input type="checkbox" .checked=${this.lanAccess} ?disabled=${this.lanAccessBusy} @change=${this._toggleLanAccess} />
              <span class="switch-track"></span>
            </label>
          </div>

          ${this.lanAccess ? html`
            <div style="margin-top: 10px; padding: 12px 14px; background: var(--bg-elevated, #1a1d25); border: 1px solid var(--border, #27272a); border-radius: 10px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                <div style="flex: 1; min-width: 0;">
                  <div style="font-size: 12px; color: var(--muted, #71717a); margin-bottom: 4px;">Gateway Token（其他设备连接时需要）</div>
                  <div style="font-family: monospace; font-size: 13px; color: var(--text, #e4e4e7); word-break: break-all;">${this.gatewayToken || "（未配置，请在配置文件中设置 gateway.auth.token）"}</div>
                </div>
                ${this.gatewayToken ? html`
                  <button
                    class="copy-token-btn"
                    style="
                      padding: 6px 12px;
                      border-radius: 8px;
                      border: 1px solid var(--border, #27272a);
                      background: var(--card, #181b22);
                      color: var(--text, #e4e4e7);
                      font-size: 12px;
                      cursor: pointer;
                      white-space: nowrap;
                      transition: all 0.15s ease;
                    "
                    @click=${this._copyGatewayToken}
                    @mouseover=${(e: Event) => {
                      (e.target as HTMLElement).style.background = "var(--bg-hover, #262a35)";
                      (e.target as HTMLElement).style.borderColor = "var(--border-strong, #3f3f46)";
                    }}
                    @mouseout=${(e: Event) => {
                      (e.target as HTMLElement).style.background = "var(--card, #181b22)";
                      (e.target as HTMLElement).style.borderColor = "var(--border, #27272a)";
                    }}
                  >复制</button>
                ` : nothing}
              </div>
            </div>
          ` : nothing}
        </div>

      </div>`;
  }

  private _renderIdentityCard() {
    return html`
      <div class="card">
        <div class="card-title">
          <div class="card-title-icon blue">${this._userIcon}</div>
          <div>
            <div class="title-text">身份配置</div>
            <div class="title-sub">设置 AI 助手名称和用户称呼</div>
          </div>
        </div>

        <div class="field">
          <label class="field-label">AI 助手名称</label>
          <input class="input-base" type="text" .value=${this.botName}
            @input=${(e: Event) => (this.botName = (e.target as HTMLInputElement).value)}
            placeholder="Clawd" />
        </div>
        <div class="field">
          <label class="field-label">你的称呼</label>
          <input class="input-base" type="text" .value=${this.userName}
            @input=${(e: Event) => (this.userName = (e.target as HTMLInputElement).value)}
            placeholder="主人" />
        </div>
        <div class="field">
          <label class="field-label">时区</label>
          <select class="input-base" .value=${this.timezone}
            @change=${(e: Event) => (this.timezone = (e.target as HTMLSelectElement).value)}>
            <option value="Asia/Shanghai" ?selected=${this.timezone === "Asia/Shanghai"}>Asia/Shanghai (北京时间)</option>
            <option value="Asia/Hong_Kong" ?selected=${this.timezone === "Asia/Hong_Kong"}>Asia/Hong_Kong (香港时间)</option>
            <option value="Asia/Tokyo" ?selected=${this.timezone === "Asia/Tokyo"}>Asia/Tokyo (东京时间)</option>
            <option value="America/New_York" ?selected=${this.timezone === "America/New_York"}>America/New_York (纽约时间)</option>
            <option value="America/Los_Angeles" ?selected=${this.timezone === "America/Los_Angeles"}>America/Los_Angeles (洛杉矶时间)</option>
            <option value="Europe/London" ?selected=${this.timezone === "Europe/London"}>Europe/London (伦敦时间)</option>
            <option value="UTC" ?selected=${this.timezone === "UTC"}>UTC</option>
          </select>
        </div>

        <div class="action-bar">
          <button class="btn-primary" ?disabled=${this.saving} @click=${this._handleSaveIdentity}>
            ${
              this.saving
                ? html`
                    <span class="spinner spinner-sm"></span>
                  `
                : nothing
            }
            保存配置
          </button>
          ${
            this.saveStatus === "success"
              ? html`
                  <span class="save-msg ok">✓ 已保存</span>
                `
              : this.saveStatus === "error"
                ? html`
                    <span class="save-msg err">保存失败</span>
                  `
                : nothing
          }
        </div>
      </div>`;
  }

  private _renderAdvancedCard() {
    return html`
      <div class="card">
        <div class="card-title">
          <div class="card-title-icon gray">${this._cpuIcon}</div>
          <div>
            <div class="title-text">高级设置</div>
            <div class="title-sub">系统行为与配置文件管理</div>
          </div>
        </div>

        <div class="toggle-row">
          <div class="toggle-row-info">
            <div class="toggle-row-icon">⚡</div>
            <div>
              <div class="toggle-text-primary">开机自启动</div>
              <div class="toggle-text-secondary">登录系统时自动启动 OpenClaw</div>
            </div>
          </div>
          <label class="switch">
            <input type="checkbox" .checked=${this.autoStart} ?disabled=${this.autoStartBusy} @change=${this._toggleAutoStart} />
            <span class="switch-track"></span>
          </label>
        </div>

        <button class="click-row" @click=${this._openConfigDir}>
          <div class="toggle-row-info">
            <div class="toggle-row-icon">📁</div>
            <div>
              <div class="toggle-text-primary">打开配置目录</div>
              <div class="toggle-text-secondary">在文件管理器中查看 ~/.openclawcn</div>
            </div>
          </div>
          <span class="chevron">${this._chevronRight}</span>
        </button>
      </div>`;
  }

  /* ── Update card ── */

  private async _handleCheckUpdate() {
    // 释放旧的更新资源
    if (this._updateRid != null) {
      try {
        const t = (window as any).__TAURI__;
        await t?.core?.invoke("plugin:updater|close", { rid: this._updateRid });
      } catch {
        /* ignore */
      }
    }
    this._updateRid = null;
    this._downloadedBytesRid = null;
    this.updateChecking = true;
    this.updateError = "";
    this.updateAvailable = false;
    this.updateDone = false;
    this.updateInstalled = false;
    try {
      const result = await checkForUpdate();
      if (result) {
        this.updateAvailable = true;
        this.updateVersion = result.version;
        this.updateNotes = result.body;
        this._updateRid = result.rid;
      } else {
        this.updateDone = true; // 已是最新
      }
    } catch (e: any) {
      this.updateError = String(e?.message || e);
    } finally {
      this.updateChecking = false;
    }
  }

  private async _handleDownloadUpdate() {
    if (this._updateRid == null) {
      this.updateError = "无法下载：更新信息缺失，请重新检查";
      return;
    }
    this.updateDownloading = true;
    this.updateProgress = 0;
    this.updateError = "";
    try {
      this._downloadedBytesRid = await downloadUpdate(this._updateRid, (percent) => {
        this.updateProgress = percent;
      });
      // 下载完成，显示重启按钮
      this.updateInstalled = true;
      this.updateDownloading = false;
    } catch (e: any) {
      this.updateError = String(e?.message || e);
      this.updateDownloading = false;
    }
  }

  private async _handleRestart() {
    const t = (window as any).__TAURI__;
    if (!t?.core?.invoke) {
      return;
    }
    // 先彻底关闭 Gateway 子进程，释放文件锁，防止安装更新时冲突
    try {
      await t.core.invoke("stop_gateway");
    } catch {
      /* best-effort */
    }

    if (this._updateRid != null && this._downloadedBytesRid != null) {
      try {
        await installUpdate(this._updateRid, this._downloadedBytesRid);
        // Windows NSIS 默认会在此步骤抛弃 Promise 直接强杀重启，代码执行不到这里。
        // 而在 macOS/Linux 设备上，该过程只在后台提取替换文件，随后秒返回成功。
        // 我们必须主动触发 Tauri 重启以使新版本生效。
        t.core.invoke("plugin:process|restart");
        return;
      } catch (e) {
        console.error("更新安装失败", e);
      }
    }
    // 普通用户手动重启、或者更新失败兜底
    t.core.invoke("plugin:process|restart");
  }

  private _renderUpdateCard() {
    return html`
      <div class="card">
        <div class="card-title">
          <div class="card-title-icon blue">${this._updateIcon}</div>
          <div>
            <div class="title-text">软件更新</div>
            <div class="title-sub">检查并安装最新版本</div>
          </div>
        </div>

        ${
          this.updateInstalled
            ? html`
          <div class="update-row">
            <div class="update-info">
              <div class="toggle-text-primary">✅ 更新已下载完成，重启后生效</div>
            </div>
            <button class="btn-primary" @click=${this._handleRestart}>重启应用</button>
          </div>
        `
            : this.updateDownloading
              ? html`
          <div class="update-row">
            <div class="update-info">
              <div class="toggle-text-primary">正在下载 v${this.updateVersion}...</div>
              <div class="update-progress-wrap">
                <div class="update-progress-bar">
                  <div class="update-progress-fill" style="width:${this.updateProgress}%"></div>
                </div>
                <span class="update-progress-pct">${this.updateProgress}%</span>
              </div>
            </div>
          </div>
        `
              : this.updateAvailable
                ? html`
          <div class="update-row">
            <div class="update-info">
              <div class="toggle-text-primary">🎉 发现新版本 v${this.updateVersion}</div>
              ${this.updateNotes ? html`<div class="toggle-text-secondary">${this.updateNotes}</div>` : nothing}
              ${this.updateError ? html`<div class="update-error">❌ ${this.updateError}</div>` : nothing}
            </div>
            <button class="btn-primary" @click=${this._handleDownloadUpdate}>下载并安装</button>
          </div>
        `
                : html`
          <div class="update-row">
            <div class="update-info">
              ${
                this.updateDone
                  ? html`
                      <div class="toggle-text-primary">✅ 当前已是最新版本</div>
                    `
                  : html`
                      <div class="toggle-text-primary">点击按钮检查是否有新版本可用</div>
                    `
              }
              ${this.updateError ? html`<div class="update-error">❌ ${this.updateError}</div>` : nothing}
            </div>
            <button class="btn-primary" ?disabled=${this.updateChecking} @click=${this._handleCheckUpdate}>
              ${
                this.updateChecking
                  ? html`
                      <span class="spinner spinner-sm"></span> 检查中…
                    `
                  : "检查更新"
              }
            </button>
          </div>
        `
        }
      </div>`;
  }

  private get _updateIcon() {
    return html`
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    `;
  }
}
