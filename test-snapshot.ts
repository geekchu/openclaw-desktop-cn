import { readConfigFileSnapshot } from "./src/config/config.js";

async function run() {
  console.log("Reading config file snapshot...");
  try {
    const snapshot = await readConfigFileSnapshot();
    console.log("Snapshot loaded. Exists:", snapshot.exists);
    const str = JSON.stringify(snapshot.config);
    console.log("Stringified config length:", str.length);
  } catch (e) {
    console.error("Crash during readConfigFileSnapshot:", e);
  }
}

run().catch(console.error);
