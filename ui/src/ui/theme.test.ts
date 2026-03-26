import { describe, expect, it, vi } from "vitest";
import { parseThemeSelection, resolveSystemTheme, resolveTheme } from "./theme.ts";

describe("resolveTheme", () => {
  it("returns light when mode is light", () => {
    expect(resolveTheme("light")).toBe("light");
  });

  it("returns dark when mode is dark", () => {
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("uses system preference when mode is system", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    expect(resolveTheme("system")).toBe("light");
    vi.unstubAllGlobals();
  });
});

describe("resolveSystemTheme", () => {
  it("mirrors the active preferred color scheme", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(resolveSystemTheme()).toBe("dark");
    vi.unstubAllGlobals();
  });
});

describe("parseThemeSelection", () => {
  it("maps legacy stored values onto theme + mode", () => {
    expect(parseThemeSelection("system", undefined)).toEqual({
      theme: "claw",
      mode: "system",
    });
    expect(parseThemeSelection("fieldmanual", undefined)).toEqual({
      theme: "dash",
      mode: "dark",
    });
  });
});
