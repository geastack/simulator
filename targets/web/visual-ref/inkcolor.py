#!/usr/bin/env python3
"""Per-colour ink top/bottom inside a y range — proves runs share a baseline.

usage: inkcolor.py <img> <y0> <y1>
Groups ink pixels by their dominant hue bucket (the app paints each inline run
a different colour), so each run's vertical extent can be read separately.
"""
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert('RGB')
y0, y1 = int(sys.argv[2]), int(sys.argv[3])
px = img.load()
def bucket(r, g, b):
    if r + g + b < 200: return None
    mx = max(r, g, b)
    if mx < 90: return None
    if r > 200 and g > 200 and b > 200: return 'white'
    if b > r + 40 and b > 120: return 'cyan'
    if r > 150 and g > 110 and b < 110: return 'yellow'
    if r > 180 and b > 90 and g < 130: return 'pink'
    return None
ext = {}
for y in range(y0, y1):
    for x in range(img.width):
        k = bucket(*px[x, y])
        if k is None: continue
        lo, hi, xl, xr = ext.get(k, (10**9, -1, 10**9, -1))
        ext[k] = (min(lo, y), max(hi, y), min(xl, x), max(xr, x))
for k, (lo, hi, xl, xr) in sorted(ext.items()):
    print(f'  {k:7s} y {lo}..{hi}  (h={hi-lo+1})  x {xl}..{xr}')
