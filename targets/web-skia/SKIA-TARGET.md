# Gea Skia target: shared contract

A Gea app compiled to WASM emits one display list per frame. The host
(`@omma/canvas-renderer`, `widget-gea`) replays it onto a `SkiaCanvas`
(`super-designer/packages/canvas-renderer/src/skia-like.ts`). The engine keeps
style, layout, text measurement and line breaking; Skia only paints.

This file is the contract between the two sides. It is frozen while work is in
flight: if it cannot express something, report that instead of editing it.

## WASM exports

Same as `targets/web/main/web_main.cpp` (`app_init`, `app_frame`,
`app_hit_test`, `app_touch_*`, `app_pointer_hover`, `app_dispatch_pointer_event*`,
`app_dispatch_key_down`), minus the `get_framebuffer_*` getters, plus:

    const uint8_t *get_skia_list_ptr(void);   // valid until the next app_frame
    int            get_skia_list_size(void);  // bytes

A host detects a Skia bundle by the presence of `get_skia_list_ptr`.

## Buffer layout (version 1)

Little-endian. Every offset is from the start of the buffer. Everything is
4-byte aligned. Coordinates are f32 in device pixels, origin top-left of the
app viewport. Colors are u32 `0xAARRGGBB`, not premultiplied.

Header, 48 bytes:

| Offset | Type | Field |
| --- | --- | --- |
| 0 | u32 | magic `0x4C4B5347` ("GSKL") |
| 4 | u16 | version = 1 |
| 6 | u16 | flags; bit 0 = identical to the previous frame's list (host may skip replay) |
| 8 | u32 | viewport width |
| 12 | u32 | viewport height |
| 16 | u32 | opsOffset |
| 20 | u32 | opsSize (bytes) |
| 24 | u32 | stringsOffset |
| 28 | u32 | stringsSize (bytes, UTF-8, no terminators) |
| 32 | u32 | fontsOffset |
| 36 | u32 | fontsCount |
| 40 | u32 | reserved 0 |
| 44 | u32 | reserved 0 |

A string reference is `u32 offset, u32 length`, the offset relative to
stringsOffset.

Font table entry, 16 bytes: `u32 fontId, u32 nameOffset, u32 nameLength, u32 reserved`.
The name is the file name of a TTF/OTF in the bundle zip (flat, no folders).
`fontId` is what `TextLine` refers to.

Op record: `u16 opcode, u16 reserved, u32 size` then the payload. `size` is the
whole record in bytes including this 8-byte header, a multiple of 4. A replayer
MUST skip an opcode it does not know by `size`.

A rect is 4 x f32 `left, top, right, bottom`. Radii are 4 x f32
`topLeft, topRight, bottomRight, bottomLeft` (circular corners).

| Opcode | Name | Payload | Replay |
| --- | --- | --- | --- |
| 1 | Save | none | `save()` |
| 2 | Restore | none | `restore()` |
| 3 | Translate | f32 dx, f32 dy | `translate` |
| 4 | ClipRect | rect | `clipRect(rect, Intersect, true)` |
| 5 | ClipRRect | rect, radii | `clipRRect(rrect, Intersect, true)` |
| 6 | FillRRect | rect, radii, u32 color | fill paint, `drawRect` when all radii are 0, else `drawRRect` |
| 7 | Border | rect (outer edge), radii (outer), 4 x f32 widths `top,right,bottom,left`, 4 x u32 colors `top,right,bottom,left` | uniform width+color: one stroked rrect inset by width/2; otherwise per-side fills clipped to the outer rrect |
| 8 | TextLine | f32 x, f32 baselineY, u32 fontId, f32 sizePx, u32 color, string ref | `drawText(text, x, baselineY, paint, font)`, the font set to subpixel positioning, linear metrics and hinting off (`SkFontHinting::kNone`) |
| 9 | SaveLayerAlpha | rect bounds, f32 alpha 0..1 | `saveLayer(paint with setAlphaf(alpha), bounds)`; closed by Restore |
| 10 | Image | u32 imageId, u32 generation, rect src (image pixels), rect dst | `drawImageRectOptions(image, src, dst, Linear, None)` |
| 11 | Concat | 9 x f32, a 3x3 matrix in row-major order `m00 m01 m02 m10 m11 m12 m20 m21 m22` mapping local to current coordinates (perspective row allowed) | `concat(matrix)`; always inside a Save/Restore pair |
| 12 | Vertices | u32 vertexCount (multiple of 3, independent triangles), u8 blend (0 = source-over, 1 = additive), u8 alpha (0..255, multiplies every vertex alpha), u16 reserved 0, then vertexCount x (f32 x, f32 y), then vertexCount x u32 color | vertices in Triangles mode with per-vertex colors, drawn with the vertex colors unmodified, with the given blend (Skia does not anti-alias vertices) |
| 13 | LinearGradient | rect, radii, f32 x0, y0, x1, y1 (gradient line start and end, same coordinates as the rect), u32 stopCount, then stopCount x (f32 offset 0..1, u32 color) | fill paint with `Shader.MakeLinearGradient(start, end, colors, offsets, Clamp)`, drawn as the rrect |
| 14 | RadialGradient | rect, radii, f32 cx, cy, f32 rx, ry (ellipse centre and radii), u32 stopCount, then stopCount x (f32 offset, u32 color) | fill paint with `Shader.MakeRadialGradient` (centre, rx, a local matrix scaling y by ry/rx about the centre, Clamp), drawn as the rrect |
| 15 | Shadow | rect and radii of the shadow shape before blurring (offset and spread already applied), f32 sigma (Gaussian blur standard deviation in pixels, 0 = sharp), u32 color, rect and radii of the casting box | an outer box shadow: the shadow rrect filled through `MaskFilter.MakeBlur(Normal, sigma, true)`, clipped to the outside of the casting box (`clipRRect(box, Difference)`), inside its own save/restore |
| 16 | Line | f32 x0, y0, x1, y1, f32 width, u32 color, u32 cap (0 butt, 1 round, 2 square) | stroke paint, `drawLine` |
| 17 | Path | u32 fillRule (0 nonzero, 1 even-odd), u32 color, u32 contourCount, then per contour: u32 pointCount followed by pointCount x (f32 x, f32 y); every contour is closed | a path of closed polylines (`moveTo`, `lineTo`..., close) filled with the color, anti-aliased, with the fill rule |
| 18 | SaveLayerBlur | rect bounds, f32 sigmaX, f32 sigmaY (Gaussian standard deviations in pixels) | `saveLayer(paint with ImageFilter.MakeBlur(sigmaX, sigmaY, Decal, null), bounds)`: everything drawn until the matching Restore is blurred as a group |

Later versions add ops with
new opcodes; the version field only changes for incompatible changes.

## Images (step 2)

The list carries no pixels. For an `(imageId, generation)` pair it has not
uploaded, the host calls these exports, synchronously, after `app_frame` and
before the next one:

    const uint8_t *skia_image_pixels(int imageId);  // RGBA8888, unpremultiplied, row-major, stride = width * 4; 0 when unavailable
    int            skia_image_width(int imageId);
    int            skia_image_height(int imageId);

The pointer is valid until the next call of `skia_image_pixels` or
`app_frame`. `generation` changes whenever the pixels of `imageId` change
(animated GIF frame, buffer updated in place, slot reused); the host then
re-reads and replaces its image. The host builds the image with
`MakeImage({width, height, RGBA_8888, Unpremul, SRGB}, bytes, width * 4)`,
caches it by imageId and deletes it on dispose. A host whose `SkiaLike` has no
`MakeImage`, or a 0 pointer, skips the op. Opacity comes from the enclosing
SaveLayerAlpha; rounded corners and overflow come from the enclosing clip ops.

## Text without a font-family

Every TextLine names a TTF. Text whose style resolves to no TTF family uses the
target's default family, which the build ships in the bundle like any other
font and which the engine measures with.

## Scope of step 1

Boxes (background, border, radius), clips (overflow), opacity, text lines, and
scroll offsets, enough to draw `examples/apps/counter-jsx` and
`examples/apps/analog-clock` minus its `<canvas>`/SVG content. Images,
gradients, shadows, transforms, SVG and `<canvas>` commands are later steps:
skip those nodes for now.

## Transforms (step 3)

The engine records transformed content pre-projected: each such command has
its local rect and four projected screen corners. The producer solves the 3x3
matrix that maps the local rect to those corners (affine when the corners form
a parallelogram within about 1px, so a 2D rotation carries no perspective) and
emits `Save, Concat, <the ordinary op on the local rect>, Restore`. The host
needs `concat(matrix: InputMatrix): void` on `SkiaCanvas`.

## 3D scenes and canvases (step 4)

A gea3d scene is emitted as geometry, not pixels: its background and its
sorted primitives become `Vertices` ops in painter's order (farthest first),
ahead of the UI's ops; lines are expanded to quads. Colors are interpolated
linearly in screen space, as gea3d's rasteriser does.

A `<canvas>` whose content is a bitmap written by the app is emitted as an
`Image` op. Its imageId has bit 31 set (the low bits are producer-defined); the
`skia_image_*` exports accept such ids like any other. Its generation changes
on every frame in which the canvas was redrawn, and only then.

## SVG and filters (step 5)

The engine flattens SVG shapes to polylines and expands strokes to outlines, so
an SVG item is a filled `Path` in device pixels inside the clip of its `<svg>`
box. An item painted with a gradient uses the existing gradient data where an
op can express it and is otherwise reported, not approximated.

`filter: blur()` on an element becomes a `SaveLayerBlur` scope around that
element's ops.
