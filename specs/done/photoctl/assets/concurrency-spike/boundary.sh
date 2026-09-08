#!/bin/zsh
cd "$(dirname "$0")"
run() {
  local N=$1 MC=$2
  pkill -f daemon.mjs 2>/dev/null; perl -e 'select(undef,undef,undef,0.4)'
  rm -rf /tmp/spk-sock /tmp/spkdir; mkdir -p /tmp/spk-sock /tmp/spkdir
  # detach daemon from this shell's job table so `wait` ignores it
  ( nohup node daemon.mjs /tmp/spk-sock /tmp/spkdir/.s.PGSQL.5432 $MC > /tmp/daemon.log 2>&1 & echo $! > /tmp/dpid ) &
  wait %1 2>/dev/null
  local DPID=$(cat /tmp/dpid)
  for i in {1..40}; do [[ -S /tmp/spkdir/.s.PGSQL.5432 ]] && break; perl -e 'select(undef,undef,undef,0.25)'; done
  echo "===== clients=$N maxConnections=$MC, expect $((N*25)) rows ====="
  local pids=()
  for i in {1..$N}; do node cli-socket.mjs /tmp/spkdir "p$i" 25 > /tmp/out.$i 2>&1 & pids+=($!); done
  for p in $pids; do wait $p; done
  echo "  client_failures=$(cat /tmp/out.* | grep -c '"ok":false')/$N"
  echo "  sample_fail: $(cat /tmp/out.* | grep '"ok":false' | head -1 | cut -c1-150)"
  echo "  daemon_alive=$(kill -0 $DPID 2>/dev/null && echo Y || echo N)  sock=$([[ -S /tmp/spkdir/.s.PGSQL.5432 ]] && echo Y || echo N)"
  echo "  daemonlog: $(tail -2 /tmp/daemon.log | tr '\n' '|' | cut -c1-200)"
  rm -f /tmp/out.*
  pkill -f daemon.mjs 2>/dev/null; perl -e 'select(undef,undef,undef,1.2)'
  printf "  "; node check.mjs /tmp/spk-sock 2>/dev/null
  echo
}
run 8 8
run 12 8
run 24 8
