export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Alias for getSystemTheme — returns the currently active system theme preference. */
export function resolveSystemTheme(): ResolvedTheme {
  return getSystemTheme();
}

export function resolveTheme(
  mode: ThemeMode,
  _systemOverride?: "light" | "dark" | "system",
): ResolvedTheme {
  if (mode === "system") {
    return getSystemTheme();
  }
  return mode;
}

/** Map legacy stored theme/mode string values to { theme, mode } pairs. */
export function parseThemeSelection(
  value: string | undefined,
  extra: unknown,
): { theme: string; mode: string } {
  void extra;
  const LEGACY_MAP: Record<string, { theme: string; mode: string }> = {
    system: { theme: "claw", mode: "system" },
    light: { theme: "claw", mode: "light" },
    dark: { theme: "claw", mode: "dark" },
    fieldmanual: { theme: "dash", mode: "dark" },
    "dash-light": { theme: "dash", mode: "light" },
    openknot: { theme: "knot", mode: "dark" },
    "openknot-light": { theme: "knot", mode: "light" },
  };
  return LEGACY_MAP[value ?? ""] ?? { theme: "claw", mode: value ?? "system" };
}
