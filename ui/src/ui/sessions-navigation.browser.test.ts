import { describe, expect, it } from "vitest";
import { mountApp as mountTestApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

function mountApp(pathname: string) {
  return mountTestApp(pathname);
}

async function flushView(app: Awaited<ReturnType<typeof mountApp>>) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await app.updateComplete;
    if ((app.textContent ?? "").includes("No sessions found.")) {
      return;
    }
  }
}

describe("sessions navigation", () => {
  it("renders the sessions view when clicking the sidebar tab", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>('a.nav-item[href="/sessions"]');
    expect(link).not.toBeNull();

    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await flushView(app);

    expect(app.tab).toBe("sessions");
    expect(window.location.pathname).toBe("/sessions");
    expect(app.textContent ?? "").toContain("Active session keys and per-session overrides.");
    expect(app.textContent ?? "").toContain("No sessions found.");
  });
});
