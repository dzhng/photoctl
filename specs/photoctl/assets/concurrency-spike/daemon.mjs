import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
const [dataDir, sockPath, maxConnStr] = process.argv.slice(2);
const db = await PGlite.create({ dataDir });
const server = new PGLiteSocketServer({ db, path: sockPath, maxConnections: Number(maxConnStr||8) });
await server.start();
console.log("DAEMON_READY");
const stop = async () => { try{ await server.stop(); }catch{} try{ await db.close(); }catch{} process.exit(0); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
