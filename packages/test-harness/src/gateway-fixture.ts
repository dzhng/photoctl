import { createServer, type Server } from "node:http";
export async function startGatewayFixture(port = 0): Promise<Server> {
  const server = createServer((_req, res) => {
    res.writeHead(501, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not implemented" }));
  });
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
