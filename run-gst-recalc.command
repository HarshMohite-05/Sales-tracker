#!/bin/bash
# Recalculates order payment stages for the GST-at-invoice rule, then runs the data link check.
cd "$(dirname "$0")"
{
  echo "=== npm run recalc:gst ==="
  npm run recalc:gst
  echo
  echo "=== npm run check:links ==="
  npm run check:links
  echo
  echo "=== done $(date) ==="
} 2>&1 | tee run-results.txt
