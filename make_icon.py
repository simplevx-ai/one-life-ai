# ONE LIFE AI 아이콘: 남색→파랑 그라데이션, 흰 'ONE' + 금색 'LIFE', 아래 작은 'AI'
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "icons")
os.makedirs(OUT, exist_ok=True)
NAVY, BLUE, GOLD, WHITE = (11, 31, 75), (28, 96, 214), (245, 196, 66), (255, 255, 255)
F = r"C:\Windows\Fonts\seguibl.ttf"
S = 1024


def bg():
    im = Image.new("RGB", (S, S))
    px = im.load()
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * (S - 1))
            px[x, y] = tuple(int(NAVY[i] + (BLUE[i] - NAVY[i]) * t) for i in range(3))
    glow = Image.new("L", (S, S), 0)
    ImageDraw.Draw(glow).ellipse([S * .1, S * .0, S * .9, S * .7], fill=60)
    glow = glow.filter(ImageFilter.GaussianBlur(S * .12))
    return Image.composite(Image.new("RGB", (S, S), (90, 150, 255)), im, glow).convert("RGBA")


def art(scale):
    im = bg()
    d = ImageDraw.Draw(im)
    cx = S / 2
    f1 = ImageFont.truetype(F, int(230 * scale))
    f2 = ImageFont.truetype(F, int(120 * scale))
    d.text((cx, S * .5 - 120 * scale), "ONE", font=f1, fill=WHITE, anchor="mm")
    d.text((cx, S * .5 + 70 * scale), "LIFE", font=f1, fill=GOLD, anchor="mm")
    d.rounded_rectangle([cx - 70 * scale, S * .5 + 200 * scale, cx + 70 * scale, S * .5 + 212 * scale], radius=6, fill=GOLD)
    d.text((cx, S * .5 + 290 * scale), "AI", font=f2, fill=WHITE, anchor="mm")
    return im


def rounded(im):
    m = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * .22), fill=255)
    o = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    o.paste(im, (0, 0), m)
    return o


normal = rounded(art(1.0))
normal.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, "icon-192.png"))
normal.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "icon-512.png"))
art(0.78).resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "icon-maskable-512.png"))  # 안전 영역 안으로 작게
normal.resize((256, 256), Image.LANCZOS).save(os.path.join(BASE, "icon_preview.png"))
print("ok")
