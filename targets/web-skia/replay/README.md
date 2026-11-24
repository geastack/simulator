# skia-replay

A native replayer for the Gea Skia display list (`../SKIA-TARGET.md`, version 1), and `gskl2png`,
a harness that replays a test kit, an external directory of dumped lists (below), and diffs it
against reference PNGs.

- `gskl_replay.h/.cpp`: `GsklReplayer`, public Skia headers only. Builds against Skia m160 and
  react-native-skia 2.15.1's bundled m154.
- `gskl2png.cpp`: `gskl2png <app dir> <out dir> [--threshold N]` replays every frame of an app's
  `manifest.json` on a raster surface and prints, per frame, the share of pixels whose
  premultiplied channels differ from the expected PNG by more than N (default 8 of 255). It
  writes `frame-NNN.png`, plus `frame-NNN.diff.png` (differing pixels in red) when any differ.

## Build

Needs a static Skia with the FreeType font manager (the one CanvasKit uses):

    cd $SKIA
    bin/gn gen out/Replay --args='is_debug=false target_cpu="arm64" skia_use_freetype=true skia_use_system_freetype2=false skia_enable_fontmgr_custom_empty=true'
    third_party/ninja/ninja -C out/Replay skia

Then, here (`SKIA` names that checkout; `RNSKIA` react-native-skia 2.15.1's `cpp/skia`):

    make SKIA=...                # builds gskl2png
    make SKIA=... KIT=... kit    # replays every app of the kit in KIT into out/
    make RNSKIA=... check-m154   # syntax-only compile against react-native-skia's m154 headers

## Test kit

A kit is a directory with one subdirectory per app; `make kit` replays each subdirectory that has
a `manifest.json` and ignores everything else. Each frame is replayed independently, on a
transparent RGBA8888 surface the size of its expected PNG, with one `GsklReplayer` per app.

    <app>/manifest.json             the frames, below
    <app>/frame-NNN.gskl            raw list bytes as returned by get_skia_list_ptr/size
    <app>/frame-NNN.png             expected render: 8-bit RGBA, unpremultiplied, viewport-sized
    <app>/fonts/<name>              TTF/OTF files, named exactly as the list's font table names them
    <app>/images/<file>             RGBA8888 unpremultiplied pixels, row-major, stride width * 4, no header

`manifest.json`:

    {
      "app": "canvas-3d-cube",
      "viewport": { "width": 410, "height": 502 },
      "dpr": 1.5,
      "frames": [
        {
          "list": "frame-005.gskl",
          "expected": "frame-005.png",
          "timeMs": 83,
          "images": [
            { "id": 2147483649, "generation": 6, "width": 410, "height": 502, "file": "images/2147483649-g6.rgba" }
          ]
        }
      ]
    }

- `app` names the app in the output (default: the directory name). `viewport` is the list
  header's width and height, in device pixels; `dpr` and `timeMs` record how the list was dumped
  (the dpr passed to `app_init`, the time passed to `app_frame`).
- `list` and `expected` are paths relative to the app directory.
- `images` lists every `(id, generation)` pair the frame's Image ops draw, with the pixels as
  they were at that frame; `id` is the unsigned imageId (a `<canvas>` id has bit 31 set) and
  `file` is relative to the app directory.

## Use

    GsklReplayer replayer(fontMgr,
                          [](const std::string& name) -> sk_sp<SkData> { /* font file bytes */ },
                          [](uint32_t id, uint32_t generation, GsklImagePixels* out) { /* RGBA8888 unpremul */ });
    std::string error;
    if (!replayer.replay(listPtr, listSize, canvas, &error)) { /* malformed list */ }

- The host supplies the `SkFontMgr`: `SkFontMgr_New_Custom_Empty()` (FreeType) matches
  CanvasKit; on Android, any manager whose `makeFromData` reads TTFs.
- One replayer per app: typefaces, fonts and images persist across frames; text blobs, paths,
  gradient shaders and blur filters persist while each replay still draws them.
- Unknown opcodes are skipped by size. A malformed list stops the replay, returns false, and
  restores the canvas to its save count; nothing is read past `size`.
- Ill-formed UTF-8 in a TextLine is drawn with U+FFFD, as the TypeScript replayer's
  `TextDecoder` does (Skia's text-to-glyph path assumes well-formed UTF-8).
- `GsklReplayer::IsUnchanged(list, size)` reads the header's identical-to-previous flag.
