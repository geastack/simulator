#!/usr/bin/env python3
"""Stack a ref crop above the matching sim crop, at 2x, for baseline inspection.

usage: crop.py <refY0> <refY1> <simY0> <simY1> <outName> [scale]
Ref is first scaled to sim's width so the two are directly comparable.
"""
import sys
from PIL import Image

ry0, ry1, sy0, sy1, name = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
scale = int(sys.argv[6]) if len(sys.argv) > 6 else 2

ref = Image.open('ref.png').convert('RGB')
sim = Image.open('sim.png').convert('RGB')
if ref.width != sim.width:
    ref = ref.resize((sim.width, round(ref.height * sim.width / ref.width)), Image.LANCZOS)

a = ref.crop((0, ry0, ref.width, ry1))
b = sim.crop((0, sy0, sim.width, sy1))
w = sim.width
canvas = Image.new('RGB', (w, a.height + b.height + 6), (255, 0, 255))
canvas.paste(a, (0, 0))
canvas.paste(b, (0, a.height + 6))
canvas = canvas.resize((w * scale, canvas.height * scale), Image.LANCZOS)
canvas.save(f'out/{name}.png')
print(f'out/{name}.png  ref[{ry0}:{ry1}] over sim[{sy0}:{sy1}]  {canvas.size}')
