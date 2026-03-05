import { forceFreePortAndWait } from "./dist/cli/ports.js";
import { loadConfig } from "./dist/config/config.js";
import { startGatewayServer } from "./dist/gateway/server.impl.js";
import { createDefaultRuntime } from "./dist/runtime.js";

async function main() {
  console.time("port-kill");
  const { killed } = await forceFreePortAndWait(18789);
  console.timeEnd("port-kill");

  if (killed.length > 0) {
    console.log("Killed:", killed);
  }

  console.time("gateway-start");
  const server = await startGatewayServer(18789, {
    bind: "loopback",
  });
  console.timeEnd("gateway-start");

  console.log("Gateway started successfully!");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
