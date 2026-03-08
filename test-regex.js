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
const re = /(?<![a-zA-Z0-9\-_])\.openclaw(?![a-zA-Z0-9\-_\.]|cn)/g;
cases.forEach((c) => console.log(c, "->", c.replace(re, ".openclawcn")));
