import { PGlite } from "@electric-sql/pglite";
const db = await PGlite.create({ dataDir: process.argv[2] });
try {
  const { rows } = await db.query(`select count(*)::int c, count(distinct tag)::int tags from photos`);
  console.log(`FINAL rows=${rows[0].c} distinct_tags=${rows[0].tags}`);
} catch(e){ console.log("FINAL UNREADABLE: "+String(e.message).slice(0,100)); }
await db.close();
