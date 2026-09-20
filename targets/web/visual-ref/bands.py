#!/usr/bin/env python3
"""Ink bands (start,end,height) of one image within a y range — for baselines.

usage: bands.py <img> [y0] [y1]
Reports each horizontal band of ink: a text line's ink top and bottom.
"""
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert('RGB')
y0 = int(sys.argv[2]) if len(sys.argv) > 2 else 0
y1 = int(sys.argv[3]) if len(sys.argv) > 3 else img.height
px = img.load()
prof = []
for y in range(y0, y1):
    n = sum(1 for x in range(0, img.width) if sum(px[x, y]) > 150)
    prof.append(n)
start = None
for i, v in enumerate(prof):
    y = y0 + i
    if v > 0 and start is None:
        start = y
    elif v == 0 and start is not None:
        print(f'  band {start}..{y-1}  h={y-start}')
        start = None
if start is not None:
    print(f'  band {start}..{y1-1}  h={y1-start}')
