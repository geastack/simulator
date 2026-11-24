#pragma once

// Replays a Gea Skia display list (GSKL version 1, see ../SKIA-TARGET.md) onto an SkCanvas.
// Uses public Skia headers only.

#include "include/core/SkData.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkRefCnt.h"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>

class SkCanvas;

// An image's pixels: RGBA8888, unpremultiplied, rows width * 4 bytes apart. The replayer copies
// them before the next call of the image source.
struct GsklImagePixels {
    int width = 0;
    int height = 0;
    const uint8_t* pixels = nullptr;
};

class GsklReplayer {
public:
    // The bytes of the font file a list's font table names; null when the host has none.
    using FontSource = std::function<sk_sp<SkData>(const std::string& name)>;
    // The pixels of (imageId, generation); false when unavailable, and the op is skipped.
    using ImageSource =
            std::function<bool(uint32_t imageId, uint32_t generation, GsklImagePixels* out)>;

    // Typefaces are made with fontMgr->makeFromData. Without images, Image ops draw nothing.
    GsklReplayer(sk_sp<SkFontMgr> fontMgr, FontSource fonts, ImageSource images = nullptr);
    ~GsklReplayer();
    GsklReplayer(const GsklReplayer&) = delete;
    GsklReplayer& operator=(const GsklReplayer&) = delete;

    // Issues the list's ops on the canvas in the list's coordinates. Unknown opcodes are skipped
    // by their size. On a malformed list it stops, returns false with a message in *error, and
    // leaves the canvas's save count as it was given; ops before the fault have been drawn.
    // Typefaces, fonts and images are kept across replays; text blobs, paths, gradient shaders and
    // blur filters are kept while each replay still draws them.
    bool replay(const uint8_t* list, size_t size, SkCanvas* canvas, std::string* error = nullptr);

    // True when the list's header says it is identical to the previous frame's list.
    static bool IsUnchanged(const uint8_t* list, size_t size);

    // Drops every cached Skia object.
    void clear();

private:
    struct Impl;
    std::unique_ptr<Impl> fImpl;
};
