#!/usr/bin/env python3
"""Side-by-side + difference report for the gea engine render vs the browser.

ref.png  : Chrome rendering of typography.html (the CSS reference)
sim.png  : the WASM simulator canvas, captured at the same device pixel ratio

Both are device-pixel images of the same 410px-wide panel, so they are directly
comparable row for row once ref is scaled to sim's width.
"""
import sys
from PIL import Image, ImageChops

d = sys.argv[1] if len(sys.argv) > 1 else '.'
ref = Image.open(f'{d}/ref.png').convert('RGB')
sim = Image.open(f'{d}/sim.png').convert('RGB')
print(f'ref {ref.size}  sim {sim.size}')

if ref.width != sim.width:
    ref = ref.resize((sim.width, round(ref.height * sim.width / ref.width)), Image.LANCZOS)
    print(f'ref scaled to {ref.size}')

h = max(ref.height, sim.height)
canvas = Image.new('RGB', (sim.width * 2 + 12, h), (255, 0, 255))
canvas.paste(ref, (0, 0))
canvas.paste(sim, (sim.width + 12, 0))
canvas.save(f'{d}/out/side-by-side.png')

# Per-row ink profile: where does each side put text?
def rows(img):
    px = img.load()
    out = []
    for y in range(img.height):
        n = 0
        for x in range(0, img.width, 2):
            r, g, b = px[x, y]
            if r + g + b > 150:
                n += 1
        out.append(n)
    return out

rr, sr = rows(ref), rows(sim)
def blocks(prof):
    out, start = [], None
    for y, v in enumerate(prof):
        if v > 0 and start is None:
            start = y
        elif v == 0 and start is not None:
            if y - start > 2:
                out.append((start, y))
            start = None
    if start is not None:
        out.append((start, len(prof)))
    return out

rb, sb = blocks(rr), blocks(sr)
print(f'ref text bands: {len(rb)}   sim text bands: {len(sb)}')
print(f'ref ink extent: {rb[0][0] if rb else 0}..{rb[-1][1] if rb else 0}')
print(f'sim ink extent: {sb[0][0] if sb else 0}..{sb[-1][1] if sb else 0}')
