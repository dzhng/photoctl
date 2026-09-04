// Control: no lock at all. Expect corruption / silent loss.
import { PGlite } from "@electric-sql/pglite";
const [dataDir, tag, rowsStr] = process.argv.slice(2);
const rows = Number(rowsStr||25); const t0=Date.now();
try {
  const db = await PGlite.create({ dataDir });
  await db.exec(`create table if not exists photos (id serial primary key, tag text, n int)`);
  for (let i=0;i<rows;i++) await db.query(`insert into photos (tag,n) values ($1,$2)`,[tag,i]);
  const { rows:c } = await db.query(`select count(*)::int as c from photos`);
  await db.close();
  console.log(JSON.stringify({ ok:true, tag, totalMs:Date.now()-t0, seen:c[0].c }));
} catch(e){ console.log(JSON.stringify({ ok:false, tag, msg:String(e.message).slice(0,80), totalMs:Date.now()-t0 })); process.exitCode=75; }
