import { forceFreePortAndWait } from "./dist/cli/ports.js";
import { startGatewayServer } from "./dist/gateway/server.impl.js";

async function main() {
  console.time("port-kill");
  const { killed } = await forceFreePortAndWait(28789);
  console.timeEnd("port-kill");

  if (killed.length > 0) {
    console.log("Killed:", killed);
  }

  console.time("gateway-start");
  await startGatewayServer(28789, {
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
