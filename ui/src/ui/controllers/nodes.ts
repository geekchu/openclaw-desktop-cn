import type { GatewayBrowserClient } from "../gateway.ts";

export type NodesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  nodesLoading: boolean;
  nodes: Array<Record<string, unknown>>;
  lastError: string | null;
};

// 使用 WeakMap 存储每个 state 实例对应的请求 Promise，防止多实例相互阻塞
const _loadPromises = new WeakMap<NodesState, Promise<void>>();

export function loadNodes(state: NodesState, opts?: { quiet?: boolean }): Promise<void> {
  const client = state.client;
  if (!client || !state.connected) {
    return Promise.resolve();
  }

  const existingPromise = _loadPromises.get(state);
  if (existingPromise) {
    // 如果一个静默请求正在进行中，而用户此时点击了刷新（非静默），
    // 应当给用户视觉反馈，并在该请求结束时关闭 loading 状态。
    if (!opts?.quiet && !state.nodesLoading) {
      state.nodesLoading = true;
      state.lastError = null;
      return existingPromise.finally(() => {
        state.nodesLoading = false;
      });
    }
    return existingPromise;
  }

  const promise = (async () => {
    // 只有在非静默模式（手动触发加载）时，才触发 UI 的 loading 状态
    if (!opts?.quiet) {
      state.nodesLoading = true;
      state.lastError = null;
    }

    try {
      const res = await client.request<{ nodes?: Record<string, unknown> }>("node.list", {});
      const newNodes = Array.isArray(res.nodes) ? res.nodes : [];
      // Only trigger Lit update if content actually changed — avoids unnecessary
      // re-renders that cause scroll position jumps on both platforms.
      if (JSON.stringify(newNodes) !== JSON.stringify(state.nodes)) {
        state.nodes = newNodes;
      }
      // 即使在静默模式下，如果请求成功了，也应该清除之前可能残留的错误状态
      if (state.lastError !== null) {
        state.lastError = null;
      }
    } catch (err) {
      if (!opts?.quiet) {
        state.lastError = String(err);
      }
    } finally {
      // 只有发起时是非静默的请求，才由底层的 finally 负责关闭 loading 状态
      if (!opts?.quiet) {
        state.nodesLoading = false;
      }
      _loadPromises.delete(state);
    }
  })();

  _loadPromises.set(state, promise);
  return promise;
}
