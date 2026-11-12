#!/usr/bin/env python3
"""釣りの機能の潮位表の地点（気象庁）を作りなおす：lib/56_sea_stations.gs

  python3 tools/sea_stations.py 2026   … 気象庁の「潮位表 掲載地点一覧表（2026年）」から、記号・名前・緯度・経度を取り出す
                                         （うみくるの地図用に ../q-umiqru/data/jma-stations.json も書く）

地点は年ごとの表にあるので、年が変わって地点がふえたら、その年で作りなおす。
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

year = sys.argv[1] if len(sys.argv) > 1 else "2026"
url = f"https://www.data.jma.go.jp/kaiyou/db/tide/suisan/station{year}.php"
html = urllib.request.urlopen(url, timeout=30).read().decode("utf-8")


def deg(text):
    m = re.match(r"(\d+)゜(\d+)'", text)
    return round(int(m.group(1)) + int(m.group(2)) / 60, 4)


rows = []
for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
    cells = [re.sub(r"<[^>]*>", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
    if len(cells) > 4 and re.fullmatch(r"[A-Z][A-Z0-9]", cells[1]) and "゜" in cells[3]:
        rows.append([cells[1], cells[2], deg(cells[3]), deg(cells[4])])
codes = [r[0] for r in rows]
assert len(rows) > 200 and len(set(codes)) == len(codes), "地点の表が読めない・記号がかさなる"
body = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rows)
out = Path(__file__).resolve().parent.parent / "lib" / "56_sea_stations.gs"
out.write_text(f"""/**
 * 56_sea_stations.gs：機能「🎣 釣り」の潮位表の地点（気象庁 潮位表 掲載地点一覧表 {year}年）。[記号, 名前, 緯度, 経度]
 * 手で直さない（tools/sea_stations.py {year} で作りなおす）。呼ばれるところ：56_sea_tide.gs の seaNearestStation_
 */

const SEA_STATIONS_ = [
{body}
];
""", encoding="utf-8")
print(f"✅ {len(rows)} 地点 → {out}")

# うみくるの地図にも同じ地点を出す（q-umiqru/data/jma-stations.json。となりのフォルダがあれば）
umi = Path(__file__).resolve().parent.parent.parent / "q-umiqru" / "data"
if umi.is_dir():
    data = {"source": f"気象庁 潮位表 掲載地点一覧表（{year}年）", "fields": ["code", "name", "lat", "lon"], "stations": rows}
    (umi / "jma-stations.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"✅ {len(rows)} 地点 → {umi / 'jma-stations.json'}")
