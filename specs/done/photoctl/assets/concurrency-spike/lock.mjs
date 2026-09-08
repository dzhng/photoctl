// Lock ported from ~/dev/duet-agent src/file-lock.ts + src/memory/pglite.ts (Apache-2.0).
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
const STALE_MS = 10*60*1000;
const POLL_BACKOFF = [10,20,40,60,80,100];
const held = new Set();
process.on("exit", () => { for (const p of held) { try { unlinkSync(p); } catch {} } });
for (const sig of ["SIGINT","SIGTERM"]) process.on(sig, () => { process.exit(1); });

function isAlive(pid){ try { process.kill(pid,0); return true; } catch(e){ return e.code === "EPERM"; } }

export function tryAcquire(dataDir){
  const lockPath = join(dataDir, ".photoctl-open.lock");
  try {
    const fd = openSync(lockPath,"wx"); writeSync(fd, `${process.pid}\n`); closeSync(fd);
    held.add(lockPath); return { lockPath };
  } catch(e){
    if (e.code !== "EEXIST") throw e;
    let holderPid = 0;
    try { holderPid = Number.parseInt(readFileSync(lockPath,"utf8").split("\n")[0],10)||0; } catch {}
    const ageOk = (()=>{ try { return Date.now()-statSync(lockPath).mtimeMs > STALE_MS; } catch { return false; } })();
    if (holderPid && holderPid !== process.pid && isAlive(holderPid) && !ageOk) return { holderPid };
    try { unlinkSync(lockPath); const fd = openSync(lockPath,"wx"); writeSync(fd,`${process.pid}\n`); closeSync(fd); held.add(lockPath); return { lockPath }; }
    catch { return { holderPid: holderPid||-1 }; }
  }
}
export async function poll(dataDir, budgetMs){
  const deadline = Date.now()+budgetMs; let i=0, lastHolder=0;
  for(;;){
    const r = tryAcquire(dataDir);
    if (r.lockPath) return r.lockPath;
    lastHolder = r.holderPid;
    if (Date.now() >= deadline) { const err = new Error(`library_locked (holder pid ${lastHolder})`); err.code="library_locked"; throw err; }
    const wait = POLL_BACKOFF[Math.min(i++, POLL_BACKOFF.length-1)];
    await new Promise(r=>setTimeout(r, Math.min(wait, Math.max(0, deadline-Date.now()))));
  }
}
export function release(lockPath){ held.delete(lockPath); try { unlinkSync(lockPath); } catch {} }
