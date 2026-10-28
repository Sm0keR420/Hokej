import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const routes = new Map([
  ["/", ["web/index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["web/styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["web/app.js", "text/javascript; charset=utf-8"]],
  ["/hockey.js", ["src/hockey.js", "text/javascript; charset=utf-8"]],
]);
const port = Number(process.env.PORT ?? 5173);

createServer(async (request, response) => {
  const route = routes.get(new URL(request.url, "http://localhost").pathname);
  if (!route) {
    response.writeHead(404).end("Not found");
    return;
  }

  try {
    const body = await readFile(join(root, route[0]));
    response.writeHead(200, { "Content-Type": route[1], "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(500).end("Unable to load the requested file");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Hokej simulator running at http://localhost:${port}`);
});