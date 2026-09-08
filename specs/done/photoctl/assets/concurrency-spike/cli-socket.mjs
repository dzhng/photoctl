// Approach B: thin client over a pglite-socket daemon.
import pg from "pg";
const [sock, tag, rowsStr] = process.argv.slice(2);
const rows = Number(rowsStr||25); const t0=Date.now();
const client = new pg.Client({ host: sock, database: "postgres", user: "postgres" });
try {
  await client.connect();
  const connMs = Date.now()-t0;
  await client.query(`create table if not exists photos (id serial primary key, tag text, n int)`);
  for (let i=0;i<rows;i++) await client.query(`insert into photos (tag,n) values ($1,$2)`,[tag,i]);
  const r = await client.query(`select count(*)::int as c from photos`);
  await client.end();
  console.log(JSON.stringify({ ok:true, tag, connMs, totalMs:Date.now()-t0, seen:r.rows[0].c }));
} catch(e){ console.log(JSON.stringify({ ok:false, tag, code:e.code||"error", msg:String(e.message).slice(0,120), totalMs:Date.now()-t0 })); try{await client.end();}catch{} process.exitCode=75; }
