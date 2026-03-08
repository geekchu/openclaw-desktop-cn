const fs = require("fs");
const config = JSON.parse(
  fs.readFileSync("C:/Users/Administrator/.openclawcn/openclaw.json", "utf8") || "{}",
);
console.log("Channels:", Object.keys(config.channels || {}));
