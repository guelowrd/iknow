#!/bin/sh
# Operator loop for the test period: open waiting stake notes on every pot every 10 minutes,
# publish an oracle heartbeat every hour. Run with: nohup sh operator/loop.sh > operator/loop.log 2>&1 &
cd "$(dirname "$0")" || exit 1
tick=0
while true; do
  for pot in $(python3 -c "import json;print(' '.join(json.load(open('state.json'))['pots']))"); do
    echo "$(date -u +%FT%TZ) batch $pot"
    node cli.mjs pot batch --pot "$pot" 2>&1 | grep -v 'source manager'
  done
  if [ $((tick % 6)) -eq 0 ]; then
    echo "$(date -u +%FT%TZ) heartbeat"
    node cli.mjs oracle heartbeat 2>&1 | grep -v 'source manager'
  fi
  tick=$((tick + 1))
  sleep 600
done
