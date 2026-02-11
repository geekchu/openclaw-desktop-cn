const fs = require("fs");
const path = require("path");
const src = path.resolve(__dirname, "../dist/control-ui");
const dst = path.resolve(__dirname, "../src-tauri/frontend");
function cp(s, d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  for (const f of fs.readdirSync(s)) {
    const a = path.join(s, f),
      b = path.join(d, f);
    fs.statSync(a).isDirectory() ? cp(a, b) : fs.copyFileSync(a, b);
  }
}
cp(src, dst);
console.log("copied");
