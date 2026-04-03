const cases = [
  "~/.openclaw/",
  '".openclaw"',
  "https://docs.openclaw.ai",
  'path.join(base, ".openclaw")',
  "com.openclaw.desktop",
  "api.openclawcn.net",
  "\\\\.openclaw\\\\",
  "openclaw.json",
  ".openclawcn",
];
const re = /(?<![a-zA-Z0-9_-])\.openclaw(?![a-zA-Z0-9_.-]|cn)/g;
cases.forEach((c) => console.log(c, "->", c.replace(re, ".openclawcn")));
