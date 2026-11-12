#!/usr/bin/env python3
"""くらぶボットの、トークの下のメニューの画像を作る（assets/richmenu-*.png・2500×843）。

上の 170 がタブの行（2つ：左はいちばん先の機能のツール（アイコン＋名前）／右はくらぶ（Qlove の横長のロゴ）。
3つ：そらくる・うみくる／つづく・しょくじ／Qlove の設定。richmenu-3-*.png。ボタンはアプリのアイコンの色）、
下の 673 にボタン（3つは横1列・4つは 2×2・6つは 2×3・8つは 2×4）。
アイコン・ロゴは、となりの q-shoquji・q-soraqru・q-umiqru・q-oqrn の SVG を tools/svg2png.swift で PNG にして使う（macOS）。
並びは lib/08_richmenu.gs（タブ・右のタブの組み合わせ RICH_CLUB_IMAGES_）と、機能の richMenu.areas（lib/61_meal.gs・50_weather.gs・56_sea.gs）と同じにする。
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
UMIQRU_ICON = GITHUB / "q-umiqru" / "icon.svg"
# 左のタブのツール：(アイコン, 名前, 選んだときの字の色)
TOOLS = {"soraqru": (SORAQRU_ICON, "そらくる", (58, 86, 214)), "shoquji": (SHOQUJI_ICON, "しょくじ", (206, 108, 8)), "umiqru": (UMIQRU_ICON, "うみくる", (14, 110, 158))}
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
    "sea": ((96, 186, 226), (14, 110, 158), "umiqru", 0, [("🐟", "釣れた", "写真なしで記録"), ("🎣", "釣り場", "一覧・足す・名前"), ("🌊", "うみくるで見る", "潮・波・風")]),
    # 右のタブ（Qlove）。左がしょくじで、天気・記録もあるとき／左がそらくる・しょくじで、ほかの入口がないとき
    "club-weather-log": (*QLOVE, "shoquji", 1, [("☁️", "天気の知らせ", "そらくる"), ("📝", "記録", "# を付けて送る"), ("🧩", "できること", "機能の一覧"), ("👥", "使う人", "許した人・使いたい")]),
    "club-sea": (*QLOVE, "umiqru", 1, CLUB_BASE),
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


def tab_specs(tool):
    """2つのタブ：左はツール（アイコン＋名前）、右は Qlove のロゴ"""
    icon, name, color = TOOLS[tool]
    return [("tools", [icon], name, color), ("logo",)]


# 3つのタブ（lib/08_richmenu.gs の RICH_TABS3_ と同じ並び。アイコンの順：そらくる・うみくる・つづく・しょくじ）
TUZUQ_ICON = GITHUB / "q-tuzuq" / "icon.svg"
TABS3 = [
    ("tools", [SORAQRU_ICON, UMIQRU_ICON], "そらくる・うみくる"),
    ("tools", [TUZUQ_ICON, SHOQUJI_ICON], "つづく・しょくじ"),
    ("logo", "設定"),  # Qlove の設定
]
# ボタンの色：アプリのアイコンの基本の色（アイコンの SVG の濃いほうの色）
APP = {"soraqru": (58, 86, 214), "umiqru": (14, 110, 158), "tuzuq": (47, 128, 216), "shoquji": (236, 138, 22), "qlove": (108, 71, 255)}
BG3 = (243, 244, 247)  # 背景（1色。グラデーションにしない）
TAB_OFF = (228, 230, 236)
INK, INK_SUB = (17, 24, 39), (107, 114, 128)


def draw3(name, active, buttons):
    """3つのタブの画像。buttons … [(絵文字, 題, 小さい字, アプリ)]。ボタンはアプリの色で塗り、字は白"""
    img = Image.new("RGBA", (W, H), BG3 + (255,))
    d = ImageDraw.Draw(img)
    tw = W / 3
    for i in range(3):
        x0 = tw * i
        d.rounded_rectangle((x0 + 24, 18, x0 + tw - 24, TAB - 12), radius=60, fill=(255, 255, 255) if i == active else TAB_OFF)
    y = (TAB + 6) // 2
    for i, spec in enumerate(TABS3):
        cx = tw * i + tw / 2
        color = INK if i == active else INK_SUB
        if spec[0] == "logo":
            logo = svg(QLOVE_LOGO, 80)
            font = HIRA(8, 64)
            width = logo.width + 20 + d.textlength(spec[1], font=font)
            x = cx - width / 2
            img.alpha_composite(logo, (int(x), int(y - logo.height / 2)))
            d.text((x + logo.width + 20, y), spec[1], font=font, fill=color, anchor="lm")
            continue
        pics = [svg(p, 92) for p in spec[1]]
        font = fit(d, spec[2], 8, 60, tw - 150 - sum(p.width + 14 for p in pics))
        width = sum(p.width + 14 for p in pics) + d.textlength(spec[2], font=font)
        x = cx - width / 2
        for p in pics:
            img.alpha_composite(p, (int(x), int(y - p.height / 2)))
            x += p.width + 14
        d.text((x, y), spec[2], font=font, fill=color, anchor="lm")
    rows, cols = grid(len(buttons))
    pw, ph = W / cols, (H - TAB) / rows
    for i, (ch, title, sub, app) in enumerate(buttons):
        x0, y0 = pw * (i % cols), TAB + ph * (i // cols)
        d.rounded_rectangle((x0 + 30, y0 + (24 if rows == 1 else 18), x0 + pw - 30, y0 + ph - (36 if rows == 1 else 14)), radius=48, fill=APP[app])
        cx, top = x0 + pw / 2, y0
        if rows == 1:
            e = emoji(ch, 190)
            img.alpha_composite(e, (int(cx - e.width / 2), int(top + 150 - e.height / 2)))
            d.text((cx, top + 380), title, font=fit(d, title, 8, 104, pw - 72 - 180), fill=(255, 255, 255), anchor="mm")
            d.text((cx, top + 500), sub, font=HIRA(6, 60), fill=(255, 255, 255), anchor="mm")
        else:
            e = emoji(ch, 132)
            title_font = fit(d, title, 8, 84, pw - 60 - 200)
            tw2 = max(d.textlength(title, font=title_font), d.textlength(sub, font=HIRA(6, 46)))
            left = cx - (e.width + 34 + tw2) / 2
            mid = top + ph / 2 + 2
            img.alpha_composite(e, (int(left), int(mid - e.height / 2)))
            d.text((left + e.width + 34, mid - 30), title, font=title_font, fill=(255, 255, 255), anchor="lm")
            d.text((left + e.width + 34, mid + 50), sub, font=HIRA(6, 46), fill=(255, 255, 255), anchor="lm")
    out = ROOT / "assets" / f"richmenu-{name}.png"
    img.convert("RGB").save(out, optimize=True)
    print(f"{out.relative_to(ROOT)}（{out.stat().st_size // 1024}KB）")


def draw_tab(img, d, spec, x0, tw, y, selected):
    """タブ1つ（x0 から幅 tw）。選んでいるタブの字はツールの色、ほかは白（ロゴは白い小さな板の上）"""
    cx = x0 + tw / 2
    if spec[0] == "logo":
        logo = svg(QLOVE_LOGO, 92)
        lx, ly = int(cx - logo.width / 2), int(y - logo.height / 2)
        if not selected:
            pill = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            ImageDraw.Draw(pill).rounded_rectangle((lx - 36, ly - 14, lx + logo.width + 36, ly + logo.height + 14), radius=50, fill=(255, 255, 255, 215))
            img.alpha_composite(pill)
        img.alpha_composite(logo, (lx, ly))
        return
    name, color = spec[2], spec[3]
    one = len(spec[1]) == 1 if spec[0] == "tools" else True
    pics = [svg(p, 104 if one else 92) for p in spec[1]] if spec[0] == "tools" else [emoji(spec[1], 92)]
    gap = 28 if one else 14
    font = HIRA(8, 76) if one else fit(d, name, 8, 60, tw - 150 - sum(p.width + gap for p in pics))
    width = sum(p.width for p in pics) + gap * len(pics) + d.textlength(name, font=font)
    x = cx - width / 2
    for p in pics:
        img.alpha_composite(p, (int(x), int(y - p.height / 2)))
        x += p.width + gap
    d.text((x, y), name, font=font, fill=color if selected else (255, 255, 255), anchor="lm")


def draw(name, light, dark, tabs, active, buttons):
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
    n = len(tabs)
    tw = W / n
    for i in range(n):
        x0 = tw * i
        ld.rounded_rectangle((x0 + 24, 18, x0 + tw - 24, TAB - 12), radius=60, fill=(255, 255, 255, 235 if i == active else 40))
    rows, cols = grid(len(buttons))
    pw, ph = W / cols, (H - TAB) / rows
    for i in range(len(buttons)):
        x0, y0 = pw * (i % cols), TAB + ph * (i // cols)
        ld.rounded_rectangle((x0 + 30, y0 + (24 if rows == 1 else 18), x0 + pw - 30, y0 + ph - (36 if rows == 1 else 14)), radius=48, fill=(255, 255, 255, 46))
    img = Image.alpha_composite(img, layer)
    d = ImageDraw.Draw(img)
    y = (TAB + 6) // 2
    for i, spec in enumerate(tabs):
        draw_tab(img, d, spec, tw * i, tw, y, i == active)
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
            sub_font = HIRA(6, 46)
            tw2 = max(d.textlength(title, font=title_font), d.textlength(sub, font=sub_font))
            left = cx - (e.width + 34 + tw2) / 2
            mid = top + ph / 2 + 2
            img.alpha_composite(e, (int(left), int(mid - e.height / 2)))
            d.text((left + e.width + 34, mid - 30), title, font=title_font, fill=(255, 255, 255), anchor="lm")
            d.text((left + e.width + 34, mid + 50), sub, font=sub_font, fill=(255, 248, 235), anchor="lm")
    out = ROOT / "assets" / f"richmenu-{name}.png"
    img.convert("RGB").save(out, optimize=True)
    print(f"{out.relative_to(ROOT)}（{out.stat().st_size // 1024}KB）")


# 3つのタブ：(名前, 選んでいるタブ, ボタン [(絵文字, 題, 小さい字, アプリ)])。並びは機能の richMenu.areas・pages をつないだもの
MENUS3 = [
    ("3-outdoor", 0, [
        ("🌦️", "天気の知らせ", "いまの地点・時間", "soraqru"), ("📍", "地点を足す", "位置情報で登録", "soraqru"), ("🌤️", "そらくるで見る", "今日・明日の空", "soraqru"),
        ("🐟", "釣れた", "写真なしで記録", "umiqru"), ("🎣", "釣り場", "一覧・足す・名前", "umiqru"), ("🌊", "うみくるで見る", "潮・波・風", "umiqru"),
    ]),
    # つづく・しょくじは、記録のページへ行くボタンだけ（機能の richMenu.pages）
    ("3-daily", 1, [
        ("📅", "つづくの記録", "習慣カレンダー", "tuzuq"), ("📊", "きょうの集計", "しょくじ・カードで", "shoquji"), ("📒", "しょくじの記録", "一覧・直す", "shoquji"),
    ]),
    ("3-settings", 2, [(ch, t, sub, "qlove") for ch, t, sub in CLUB_BASE]),
]


def main():
    for name, (light, dark, tool, active, buttons) in MENUS.items():
        draw(name, light, dark, tab_specs(tool), active, buttons)
    for name, active, buttons in MENUS3:
        draw3(name, active, buttons)


if __name__ == "__main__":
    main()
