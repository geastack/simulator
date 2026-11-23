#pragma once

#include "pixel.h"

namespace gea::web_skia {

// Receives each text line the engine's text drawer lays out: `top` is the top
// of the line's glyph box (the baseline sits one ascender below it).
using TextLineSink = void (*)(void *user, const char *text, int x, int top, gea::framework::graphics::pixel::native_t color,
                              int familyId, int sizePx);

// While a capture is open, Display text calls go to `sink` instead of the
// framebuffer and Display::clip reports the given inclusive clip.
void beginTextCapture(TextLineSink sink, void *user, int x0, int y0, int x1, int y1);
void endTextCapture();

}  // namespace gea::web_skia
