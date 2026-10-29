#!/bin/bash
# Backs up, then empties every table in the CRM database (users included).
cd "$(dirname "$0")"
{
  echo "=== wipe database $(date) ==="
  npx tsx scripts/wipe-db.ts
  echo "=== done $(date) ==="
} 2>&1 | tee wipe-results.txt
