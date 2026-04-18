const OPENCLAW_CLI_PACKAGE_RE = String.raw`openclaw(?:@[^\s]+)?`;

const BLOCKED_PATTERNS = [
  String.raw`\bopenclaw\s+(?:update|uninstall)\b`,
  String.raw`\bnpm\s+(?:i|install)\s+(?:-[^\S\r\n]*g|--global)\s+${OPENCLAW_CLI_PACKAGE_RE}\b`,
] as const;

const BLOCKED_TERMINAL_COMMAND_RE = new RegExp(BLOCKED_PATTERNS.join("|"), "i");

export function isBlockedTerminalCommand(input: string): boolean {
  return BLOCKED_TERMINAL_COMMAND_RE.test(input);
}

