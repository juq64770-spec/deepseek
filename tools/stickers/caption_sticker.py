# -*- coding: utf-8 -*-
"""给表情包底图压配文：白字 + 黑描边，贴底居中，字号随宽度自适应。

用法：
  python tools/stickers/caption_sticker.py 底图.png "配文" 输出.png [--top]

为什么在本地做：配文要稳定、可复现，生图模型写中文经常糊字。
依赖 Pillow（pip install pillow，本机走代理 7897）。
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_PATH = r"C:\Windows\Fonts\msyhbd.ttc"  # 微软雅黑 Bold，Windows 自带
MAX_FONT_SIZE = 96
MIN_FONT_SIZE = 32
WIDTH_RATIO = 0.88     # 文字最多占画面宽度的比例
BOTTOM_MARGIN_RATIO = 0.045


def fit_font(draw, text, max_width):
    """从大到小试字号，找到能塞进 max_width 的最大字号。"""
    for size in range(MAX_FONT_SIZE, MIN_FONT_SIZE - 1, 2):
        font = ImageFont.truetype(FONT_PATH, size)
        stroke = max(2, size // 10)
        box = draw.textbbox((0, 0), text, font=font, stroke_width=stroke)
        if box[2] - box[0] <= max_width:
            return font, stroke
    font = ImageFont.truetype(FONT_PATH, MIN_FONT_SIZE)
    return font, 3


def caption(image_path, text, out_path, top=False):
    img = Image.open(image_path).convert("RGBA")
    draw = ImageDraw.Draw(img)
    font, stroke = fit_font(draw, text, int(img.width * WIDTH_RATIO))

    box = draw.textbbox((0, 0), text, font=font, stroke_width=stroke)
    w, h = box[2] - box[0], box[3] - box[1]
    x = (img.width - w) / 2 - box[0]
    margin = int(img.height * BOTTOM_MARGIN_RATIO)
    y = margin - box[1] if top else img.height - h - margin - box[1]

    draw.text((x, y), text, font=font, fill="white",
              stroke_width=stroke, stroke_fill="#1a1a1a")
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out_path, "PNG")
    return out_path


if __name__ == "__main__":
    args = sys.argv[1:]
    top = "--top" in args
    args = [a for a in args if a != "--top"]
    if len(args) != 3:
        print(__doc__)
        sys.exit(1)
    src, text, dst = args
    print(caption(src, text, dst, top=top))
