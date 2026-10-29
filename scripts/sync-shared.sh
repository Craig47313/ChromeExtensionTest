#!/bin/sh
# Copies everything in shared/ into both extensions (Chrome can't load files from outside an
# extension's own folder). Edit shared/, run this, commit the copies. tests/shared.test.js
# fails if a copy drifts.
set -e
cd "$(dirname "$0")/.."
for dir in lib timecheck/lib; do
  for f in shared/*; do
    cp "$f" "$dir/$(basename "$f")"
  done
done
echo "Synced $(ls shared | wc -l | tr -d ' ') shared files into lib/ and timecheck/lib/"
