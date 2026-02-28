#!/usr/bin/env bash
set -euo pipefail

# Replace hardcoded backend URL occurrences with env-driven values.
# - vite configs: use process.env.VITE_API_URL fallback
# - yaml files: use ${VITE_API_URL:-${VITE_API_URL}}
# - js/ts files: use process.env.VITE_API_URL fallback

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "Searching for files containing ${VITE_API_URL} under $ROOT_DIR"
mapfile -t FILES < <(grep -RIl "${VITE_API_URL}" "$ROOT_DIR" || true)

if [ ${#FILES[@]} -eq 0 ]; then
  echo "No occurrences found. Nothing to do."
  exit 0
fi

for f in "${FILES[@]}"; do
  case "$f" in
    */vite.config.*)
      echo "Patching Vite config: $f"
      sed -i.bak "s|target: '${VITE_API_URL}'|target: process.env.VITE_API_URL || '${VITE_API_URL}'|g" "$f" || true
      sed -i.bak "s|target: \"${VITE_API_URL}\"|target: process.env.VITE_API_URL || '${VITE_API_URL}'|g" "$f" || true
      ;;
    *.yml|*.yaml)
      echo "Patching YAML: $f"
      sed -i.bak "s|${VITE_API_URL}|\${VITE_API_URL:-${VITE_API_URL}}|g" "$f" || true
      ;;
    *.ts|*.tsx|*.js|*.jsx)
      echo "Patching JS/TS: $f"
      sed -i.bak "s|${VITE_API_URL}|process.env.VITE_API_URL || '${VITE_API_URL}'|g" "$f" || true
      ;;
    *)
      echo "Patching generic file: $f"
      sed -i.bak "s|${VITE_API_URL}|\${VITE_API_URL}|g" "$f" || true
      ;;
  esac
  rm -f "${f}.bak"
done

echo "Replacements complete. Run 'git status' to review changes." 
