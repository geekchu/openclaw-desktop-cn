import { describePackageManifestContract } from "../../test/helpers/extensions/package-manifest-contract.js";

describePackageManifestContract({
  pluginId: "discord",
  runtimeDeps: ["@buape/carbon", "https-proxy-agent", "opusscript"],
  minHostVersionBaseline: "2026.3.22",
});
