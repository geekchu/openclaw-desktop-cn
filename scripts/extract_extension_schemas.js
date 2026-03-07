const fs = require("fs");
const path = require("path");

const extensions = [
  "telegram",
  "discord",
  "slack",
  "imessage",
  "whatsapp",
  "wecom",
  "dingtalk",
  "qqbot",
];

for (const ext of extensions) {
  const extPath = path.join("extensions", ext, "src", "channel.ts");
  if (fs.existsSync(extPath)) {
    const content = fs.readFileSync(extPath, "utf8");
    console.log(`\n\n=== ${ext} ===`);
    // Find configSchema block
    const match = content.match(/configSchema|ConfigSchema/);
    if (match) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(content.length, match.index + 500);
      console.log(content.substring(start, end));
    } else {
      console.log("No configSchema found.");
    }
  } else {
    console.log(`\n\n=== ${ext} ===`);
    console.log(`Path not found: ${extPath}`);
  }
}
