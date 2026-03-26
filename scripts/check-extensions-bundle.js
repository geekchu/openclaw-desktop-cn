const fs = require("fs");
const path = require("path");

const extensionsDir = path.join(process.cwd(), "extensions");
const extensions = [];
const missed = [];

for (const ext of fs.readdirSync(extensionsDir)) {
  const extPath = path.join(extensionsDir, ext);
  if (!fs.existsSync(path.join(extPath, "package.json"))) {
    continue;
  }

  const entryCandidates = ["dist/index.js", "index.ts", "index.js", "src/index.ts", "src/index.js"];
  const entry = entryCandidates.find((c) => fs.existsSync(path.join(extPath, c)));

  if (entry) {
    extensions.push({ name: ext, entry });
  } else {
    missed.push(ext);
  }
}

console.log(`Found ${extensions.length}`);
console.log(`Missed:`, missed);
