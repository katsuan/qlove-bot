#!/bin/zsh
# くらぶボットを clasp で送る。送る先は tools/clasp/targets.json（git に入れない。targets.example.json を写す）
#
#   tools/publish.sh lib    … ライブラリを送り、新しい版を作る（使う人は、ライブラリの版を上げるだけ）
#   tools/publish.sh dist   … 配布用シートの入口を送る（ライブラリの版は、いちばん新しいもの）
#   tools/publish.sh all    … lib → dist（ふだんはこれ）
#
# 決まり
# - 手元に未コミットの変更があれば送らない。テストが通らなければ送らない
# - 送るファイルは一時フォルダにそろえてから送る（手元のよけいなファイルが混ざらない）
# - 鍵（スクリプト プロパティ）は送らない。配布用シートのスクリプト プロパティは空のまま
set -e
REPO="${0:A:h:h}"
TARGETS="$REPO/tools/clasp/targets.json"
MODE="${1:-all}"
cd "$REPO"
[[ -f "$TARGETS" ]] || { echo "❌ tools/clasp/targets.json がありません（targets.example.json を写して、スクリプト ID を入れる）"; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "❌ 未コミットの変更があります"; exit 1; }
node --test test/ >/dev/null || { echo "❌ テストが通りません（npm test）"; exit 1; }
conf() { python3 -c "import json;print(json.load(open('$TARGETS'))['$1']['$2'])"; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

push_lib() {
  mkdir -p "$TMP/lib" && cp lib/*.gs lib/appsscript.json "$TMP/lib/"
  echo "{\"scriptId\":\"$(conf lib scriptId)\",\"rootDir\":\".\"}" > "$TMP/lib/.clasp.json"
  (cd "$TMP/lib" && clasp push --force >/dev/null && clasp version "$(git -C "$REPO" log -1 --format='%h %s' | cut -c1-90)" | tail -1)
  echo "✅ ライブラリを送り、版を作りました（$(git log -1 --format=%h)）"
}

latest_version() {
  (cd "$TMP/lib" 2>/dev/null || { mkdir -p "$TMP/lib" && cd "$TMP/lib" && echo "{\"scriptId\":\"$(conf lib scriptId)\",\"rootDir\":\".\"}" > .clasp.json; }; clasp versions 2>&1 | grep -oE '^[0-9]+' | sort -n | tail -1)
}

push_dist() {
  local v=$(latest_version)
  [[ -n "$v" ]] || { echo "❌ ライブラリの版がありません（tools/publish.sh lib）"; exit 1; }
  mkdir -p "$TMP/dist" && cp entry/*.gs "$TMP/dist/"
  sed -e "s/__LIBRARY_SCRIPT_ID__/$(conf lib scriptId)/" -e "s/__LIBRARY_VERSION__/$v/" entry/appsscript.json > "$TMP/dist/appsscript.json"
  echo "{\"scriptId\":\"$(conf dist scriptId)\",\"rootDir\":\".\"}" > "$TMP/dist/.clasp.json"
  (cd "$TMP/dist" && clasp push --force >/dev/null)
  echo "✅ 配布用シートの入口を送りました（ライブラリの版 $v）"
}

case "$MODE" in
  lib) push_lib ;;
  dist) push_dist ;;
  all) push_lib && push_dist ;;
  *) echo "lib / dist / all"; exit 1 ;;
esac
