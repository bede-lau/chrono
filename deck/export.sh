#!/usr/bin/env bash
# Export deck/chrono-deck.html -> deck/Chrono.pdf (4 pages, 1920x1080)
# and deck/previews/slide-N.png (one PNG per slide) for visual QA.
#
# Usage: ./deck/export.sh   (run from anywhere; paths are resolved relative to this script)
set -euo pipefail

DECK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTML_FILE="$DECK_DIR/chrono-deck.html"
PDF_FILE="$DECK_DIR/Chrono.pdf"
PREVIEW_DIR="$DECK_DIR/previews"
DIA_BIN="/Applications/Dia.app/Contents/MacOS/Dia"

mkdir -p "$PREVIEW_DIR"

echo "== Chrono deck export =="
echo "HTML: $HTML_FILE"
echo "PDF:  $PDF_FILE"

pdf_ok=false

# ---- 1. Try Dia (Chromium-based) headless print-to-pdf ----
if [ -x "$DIA_BIN" ]; then
  echo "-- Trying Dia headless print-to-pdf --"
  rm -f "$PDF_FILE"
  set +e
  "$DIA_BIN" --headless=new --disable-gpu --no-pdf-header-footer \
    --virtual-time-budget=5000 \
    --print-to-pdf="$PDF_FILE" \
    "file://$HTML_FILE"
  dia_status=$?
  set -e
  if [ $dia_status -eq 0 ] && [ -s "$PDF_FILE" ]; then
    echo "Dia produced a PDF ($(wc -c < "$PDF_FILE") bytes)."
    pdf_ok=true
  else
    echo "Dia headless print-to-pdf failed or produced an empty file (exit $dia_status)."
  fi
else
  echo "Dia not found at $DIA_BIN, skipping."
fi

# ---- 2. Fallback: Playwright chromium ----
if [ "$pdf_ok" = false ]; then
  echo "-- Falling back to Playwright chromium for PDF export --"
  node "$DECK_DIR/render.mjs" pdf "$HTML_FILE" "$PDF_FILE"
  if [ -s "$PDF_FILE" ]; then
    pdf_ok=true
  fi
fi

if [ "$pdf_ok" = false ]; then
  echo "ERROR: could not produce $PDF_FILE with either Dia or Playwright." >&2
  exit 1
fi

# ---- 3. Verify page count (avoid the "/Type /Page" vs "/Type /Pages" substring trap) ----
echo "-- Verifying page count --"
page_count=$(python3 - "$PDF_FILE" <<'PYEOF'
import re, sys
data = open(sys.argv[1], "rb").read()
# Count leaf /Type /Page objects, excluding /Type /Pages (the page-tree node).
matches = re.findall(rb"/Type\s*/Page(?!s)\b", data)
print(len(matches))
PYEOF
)
echo "Detected page objects: $page_count"
if [ "$page_count" != "4" ]; then
  echo "WARNING: expected 4 pages, found $page_count. Inspect $PDF_FILE manually." >&2
fi

# ---- 4. PNG previews of each slide (always via Playwright, for pixel QA) ----
echo "-- Rendering PNG previews of each slide --"
node "$DECK_DIR/render.mjs" previews "$HTML_FILE" "$PREVIEW_DIR"

echo "== Done =="
echo "PDF:      $PDF_FILE"
echo "Previews: $PREVIEW_DIR/slide-1.png .. slide-4.png"
