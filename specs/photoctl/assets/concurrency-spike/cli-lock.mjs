// Approach A: process-per-command + advisory lockfile. Mirrors photoctl's real shape.
import { PGlite } from "@electric-sql/pglite";
import { poll, release } from "./lock.mjs";
const [dataDir, tag, rowsStr, budgetStr] = process.argv.slice(2);
const rows = Number(rowsStr||25), budget = Number(budgetStr||30000);
const t0 = Date.now(); let lockPath, waited=0;
try {
  lockPath = await poll(dataDir, budget); waited = Date.now()-t0;
  const tOpen = Date.now();
  const db = await PGlite.create({ dataDir });
  const openMs = Date.now()-tOpen;
  await db.exec(`create table if not exists photos (id serial primary key, tag text, n int)`);
  for (let i=0;i<rows;i++) await db.query(`insert into photos (tag,n) values ($1,$2)`,[tag,i]);
  const { rows: c } = await db.query(`select count(*)::int as c from photos`);
  await db.close();
  console.log(JSON.stringify({ ok:true, tag, waitedMs:waited, openMs, totalMs:Date.now()-t0, seen:c[0].c }));
} catch (e) {
  console.log(JSON.stringify({ ok:false, tag, code:e.code||"error", msg:String(e.message).slice(0,120), totalMs:Date.now()-t0 }));
  process.exitCode = 75;
} finally { if (lockPath) release(lockPath); }
