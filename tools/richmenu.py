#!/usr/bin/env python3
"""くらぶボットの、トークの下のメニューの画像を作る（assets/richmenu-*.png・2500×843）。

上の 170 がタブの行（左：いちばん先の機能のツール（そらくるのアイコン＋名前）／右：くらぶ（Qlove の横長のロゴ））、下の 673 にボタンが3つ。
アイコン・ロゴは、となりの q-soraqru・q-oqrn の SVG を tools/svg2png.swift で PNG にして使う（macOS）。
並びは lib/07_richmenu.gs（タブ）と、機能の richMenu.areas（lib/50_weather.gs など）と同じにする。
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
QLOVE_LOGO = GITHUB / "q-oqrn" / "shared" / "qlove" / "logo.svg"


def svg(path, height):
    """SVG → 背景が透明な PNG（高さ height px）"""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.png"
        subprocess.run(["swift", str(ROOT / "tools" / "svg2png.swift"), str(path), str(out), str(height)], check=True, capture_output=True)
        return Image.open(out).convert("RGBA").copy()
MENUS = {
    # 名前: (色の明るいほう, 濃いほう, 選んでいるタブ, ボタン [(絵文字, 題, 小さい字)])
    "weather": ((150, 172, 255), (58, 86, 214), 0, [("🌦️", "天気の知らせ", "いまの地点・時間"), ("📍", "地点を足す", "位置情報で登録"), ("🌤️", "そらくるで見る", "今日・明日の空")]),
    "club": ((170, 140, 255), (108, 71, 255), 1, [("🧩", "できること", "機能の一覧"), ("🔗", "ツールとつなぐ", "つなぐ番号を出す"), ("👥", "使う人", "許した人・使いたい")]),
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


def draw(name, light, dark, active, buttons):
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
    pw = W / 3
    for i in range(3):
        ld.rounded_rectangle((pw * i + 36, TAB + 24, pw * (i + 1) - 36, H - 36), radius=56, fill=(255, 255, 255, 46))
    img = Image.alpha_composite(img, layer)
    d = ImageDraw.Draw(img)
    y = (TAB + 6) // 2
    # 左のタブ：そらくるのアイコン＋「そらくる」
    font = HIRA(8, 76)
    icon = svg(SORAQRU_ICON, 104)
    width = icon.width + 28 + d.textlength("そらくる", font=font)
    x = 625 - width / 2
    img.alpha_composite(icon, (int(x), int(y - icon.height / 2)))
    d.text((x + icon.width + 28, y), "そらくる", font=font, fill=(58, 86, 214) if active == 0 else (255, 255, 255), anchor="lm")
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
        cx = pw * i + pw / 2
        e = emoji(ch, 190)
        img.alpha_composite(e, (int(cx - e.width / 2), int(TAB + 150 - e.height / 2)))
        d.text((cx, TAB + 380), title, font=fit(d, title, 8, 104, pw - 72 - 180), fill=(255, 255, 255), anchor="mm")
        d.text((cx, TAB + 500), sub, font=HIRA(6, 60), fill=(235, 240, 255), anchor="mm")
    out = ROOT / "assets" / f"richmenu-{name}.png"
    img.convert("RGB").save(out, optimize=True)
    print(f"{out.relative_to(ROOT)}（{out.stat().st_size // 1024}KB）")


def main():
    for name, (light, dark, active, buttons) in MENUS.items():
        draw(name, light, dark, active, buttons)


if __name__ == "__main__":
    main()
