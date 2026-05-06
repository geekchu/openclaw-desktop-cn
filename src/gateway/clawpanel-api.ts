import type { IncomingMessage, ServerResponse } from "node:http";
import { request as httpRequest } from "node:http";

const CLAWPANEL_PORT = 19527;

export function handleClawPanelApiRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");

  // Proxy all /api/* requests to ClawPanel backend
  if (url.pathname.startsWith("/api/")) {
    proxyToClawPanel(req, res, url);
    return true;
  }

  return false;
}

function proxyToClawPanel(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const options = {
    hostname: "127.0.0.1",
    port: CLAWPANEL_PORT,
    path: url.pathname + url.search,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = httpRequest(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: false,
        error: `ClawPanel 后端连接失败: ${err.message}`,
      }),
    );
  });

  req.pipe(proxyReq);
}
