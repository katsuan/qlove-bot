#!/usr/bin/env python3
"""くらぶボットの、トークの下のメニューの画像を作る（assets/richmenu-*.png・2500×843）。

上の 170 がタブの行（左：いちばん先の機能のツール（しょくじ・そらくるのアイコン＋名前）／右：くらぶ（Qlove の横長のロゴ））、
下の 673 にボタン（3つは横1列・4つは 2×2・6つは 2×3）。
アイコン・ロゴは、となりの q-shoquji・q-soraqru・q-oqrn の SVG を tools/svg2png.swift で PNG にして使う（macOS）。
並びは lib/08_richmenu.gs（タブ・右のタブの組み合わせ RICH_CLUB_IMAGES_）と、機能の richMenu.areas（lib/61_meal.gs・50_weather.gs）と同じにする。
字はヒラギノ角ゴシック、絵文字は Apple Color Emoji（macOS）。

使い方: python3 tools/richmenu.py
"""
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H, TAB = 2500, 843, 170
HIRA = lambda w, size: ImageFont.truetype(f"/System/Library/Fonts/ヒラギノ角ゴシック W{w}.ttc", size)  # noqa: E731
GITHUB = ROOT.parent
SORAQRU_ICON = GITHUB / "q-soraqru" / "icon.svg"
SHOQUJI_ICON = GITHUB / "q-shoquji" / "icon.svg"
# 左のタブのツール：(アイコン, 名前, 選んだときの字の色)
TOOLS = {"soraqru": (SORAQRU_ICON, "そらくる", (58, 86, 214)), "shoquji": (SHOQUJI_ICON, "しょくじ", (206, 108, 8))}
QLOVE_LOGO = GITHUB / "q-oqrn" / "shared" / "qlove" / "logo.svg"


def svg(path, height):
    """SVG → 背景が透明な PNG（高さ height px）"""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.png"
        subprocess.run(["swift", str(ROOT / "tools" / "svg2png.swift"), str(path), str(out), str(height)], check=True, capture_output=True)
        return Image.open(out).convert("RGBA").copy()
QLOVE = ((170, 140, 255), (108, 71, 255))
CLUB_BASE = [("🧩", "できること", "機能の一覧"), ("🔗", "ツールとつなぐ", "つなぐ番号を出す"), ("👥", "使う人", "許した人・使いたい")]
MENUS = {
    # 名前: (色の明るいほう, 濃いほう, 左のタブのツール, 選んでいるタブ, ボタン [(絵文字, 題, 小さい字)])
    # 左のタブ（機能）
    "meal": ((255, 196, 72), (236, 138, 22), "shoquji", 0, [
        ("🍞", "朝", "画面で入れる"), ("🍱", "昼", "画面で入れる"), ("🍲", "夜", "画面で入れる"),
        ("🍪", "間食", "画面で入れる"), ("📊", "きょうの集計", "カードで見る"), ("📒", "一覧・直す", "しょくじで"),
    ]),
    "weather": ((150, 172, 255), (58, 86, 214), "soraqru", 0, [("🌦️", "天気の知らせ", "いまの地点・時間"), ("📍", "地点を足す", "位置情報で登録"), ("🌤️", "そらくるで見る", "今日・明日の空")]),
    # 右のタブ（Qlove）。左がしょくじで、天気・記録もあるとき／左がそらくる・しょくじで、ほかの入口がないとき
    "club-weather-log": (*QLOVE, "shoquji", 1, [("☁️", "天気の知らせ", "そらくる"), ("📝", "記録", "# を付けて送る"), ("🧩", "できること", "機能の一覧"), ("👥", "使う人", "許した人・使いたい")]),
    "club-meal": (*QLOVE, "shoquji", 1, CLUB_BASE),
    "club": (*QLOVE, "soraqru", 1, CLUB_BASE),
}


def emoji(ch, size):
    font = ImageFont.truetype("/System/Library/Fonts/Apple Color Emoji.ttc", 160)
    im = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((100, 100), ch, font=font, embedded_color=True, anchor="mm")
    im = im.crop(im.getbbox())
    k = size / max(im.size)
    return im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)


def fit(d, text, weight, size, width):
    while size > 40 and d.textlength(text, font=HIRA(weight, size)) > width:
        size -= 2
    return HIRA(weight, size)


def grid(n):
    """ボタンの並び（段・列）：3つまでは1段、4つは 2×2、6つは 2×3（lib/08_richmenu.gs の richBodyAreas_ と同じ）"""
    rows = 2 if n > 3 else 1
    return rows, -(-n // rows)


def draw(name, light, dark, tool, active, buttons):
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            t = (x / (W - 1) + y / (H - 1)) / 2
            px[x, y] = tuple(round(light[i] + (dark[i] - light[i]) * t) for i in range(3))
    img = img.convert("RGBA")
    # うすく重ねる板（同じ絵に直接描くと、透けずに真っ白になる）
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for i in range(2):
        x0 = 1250 * i
        if i == active:
            ld.rounded_rectangle((x0 + 24, 18, x0 + 1250 - 24, TAB - 12), radius=60, fill=(255, 255, 255, 235))
        else:
            ld.rounded_rectangle((x0 + 24, 18, x0 + 1250 - 24, TAB - 12), radius=60, fill=(255, 255, 255, 40))
    rows, cols = grid(len(buttons))
    pw, ph = W / cols, (H - TAB) / rows
    for i in range(len(buttons)):
        x0, y0 = pw * (i % cols), TAB + ph * (i // cols)
        ld.rounded_rectangle((x0 + 30, y0 + (24 if rows == 1 else 18), x0 + pw - 30, y0 + ph - (36 if rows == 1 else 14)), radius=48, fill=(255, 255, 255, 46))
    img = Image.alpha_composite(img, layer)
    d = ImageDraw.Draw(img)
    y = (TAB + 6) // 2
    # 左のタブ：ツールのアイコン＋名前（しょくじ・そらくる）
    icon_path, tool_name, tool_color = TOOLS[tool]
    font = HIRA(8, 76)
    icon = svg(icon_path, 104)
    width = icon.width + 28 + d.textlength(tool_name, font=font)
    x = 625 - width / 2
    img.alpha_composite(icon, (int(x), int(y - icon.height / 2)))
    d.text((x + icon.width + 28, y), tool_name, font=font, fill=tool_color if active == 0 else (255, 255, 255), anchor="lm")
    # 右のタブ：Qlove の横長のロゴ（白い板の上はふつうの色、色の上は明るい色）
    # 選んでいないときは、ロゴの後ろに白い小さな板（色の上だと読みにくいため）
    logo = svg(QLOVE_LOGO, 92)
    lx, ly = int(1250 + 625 - logo.width / 2), int(y - logo.height / 2)
    if active != 1:
        pill = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(pill).rounded_rectangle((lx - 36, ly - 14, lx + logo.width + 36, ly + logo.height + 14), radius=50, fill=(255, 255, 255, 215))
        img.alpha_composite(pill)
    img.alpha_composite(logo, (lx, ly))
    for i, (ch, title, sub) in enumerate(buttons):
        cx = pw * (i % cols) + pw / 2
        top = TAB + ph * (i // cols)
        if rows == 1:
            e = emoji(ch, 190)
            img.alpha_composite(e, (int(cx - e.width / 2), int(top + 150 - e.height / 2)))
            d.text((cx, top + 380), title, font=fit(d, title, 8, 104, pw - 72 - 180), fill=(255, 255, 255), anchor="mm")
            d.text((cx, top + 500), sub, font=HIRA(6, 60), fill=(235, 240, 255), anchor="mm")
        else:
            # 2段：絵文字を左、題と小さい字を右に（1つの板の高さが半分なので）
            e = emoji(ch, 132)
            title_font = fit(d, title, 8, 84, pw - 60 - 200)
            tw = max(d.textlength(title, font=title_font), d.textlength(sub, font=HIRA(6, 46)))
            left = cx - (e.width + 34 + tw) / 2
            mid = top + ph / 2 + 2
            img.alpha_composite(e, (int(left), int(mid - e.height / 2)))
            d.text((left + e.width + 34, mid - 30), title, font=title_font, fill=(255, 255, 255), anchor="lm")
            d.text((left + e.width + 34, mid + 50), sub, font=HIRA(6, 46), fill=(255, 248, 235), anchor="lm")
    out = ROOT / "assets" / f"richmenu-{name}.png"
    img.convert("RGB").save(out, optimize=True)
    print(f"{out.relative_to(ROOT)}（{out.stat().st_size // 1024}KB）")


def main():
    for name, (light, dark, tool, active, buttons) in MENUS.items():
        draw(name, light, dark, tool, active, buttons)


if __name__ == "__main__":
    main()
