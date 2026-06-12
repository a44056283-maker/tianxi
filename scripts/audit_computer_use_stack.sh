#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[apps]"
for path in \
  "/Applications/WeChat 2.app/" \
  "/Applications/Google Chrome.app/" \
  "/Applications/360极速浏览器.app/"
do
  if [ -d "$path" ]; then
    echo "ok: $path"
  else
    echo "missing: $path"
  fi
done

echo
echo "[system binaries]"
for bin in tesseract ocrmypdf screencapture; do
  if command -v "$bin" >/dev/null 2>&1; then
    echo "ok: $bin -> $(command -v "$bin")"
  else
    echo "missing: $bin"
  fi
done

echo
echo "[python modules]"
python3 - <<'PY'
mods = ['pytesseract', 'easyocr', 'PIL', 'cv2']
for name in mods:
    try:
        __import__(name)
        print(f"ok: {name}")
    except Exception:
        print(f"missing: {name}")
PY

echo
echo "[bundled runtime python modules]"
BUNDLED_PY="/Users/luxiangnan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
if [ -x "$BUNDLED_PY" ]; then
  "$BUNDLED_PY" - <<'PY'
mods = ['pytesseract', 'easyocr', 'PIL', 'cv2', 'rapidocr_onnxruntime', 'numpy']
for name in mods:
    try:
        __import__(name)
        print(f"ok: {name}")
    except Exception:
        print(f"missing: {name}")
PY
else
  echo "missing: bundled python runtime"
fi
