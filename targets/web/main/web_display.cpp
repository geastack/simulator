// Web platform display: implements gea::platform::display::Display against an
// RGB565 framebuffer canvas, exactly as the ESP32 target draws into its panel
// framebuffer (targets/esp32/display.cpp). The only difference is the
// "transport": there is no QSPI panel — the browser reads the framebuffer
// straight out of WASM memory each frame (see simulator/src/main.ts), so
// flush() is a no-op and the per-frame draws land directly in the canvas the
// JS side presents. present() rasterizes a canvas-2d batch into that same
// framebuffer via the shared command rasterizer (display_present.h), so
// GEA_EMBEDDED_DIRECT_CANVAS_CONTEXT builds (canvas-3d) present exactly like
// the device — minus the panel DMA.
//
// The framebuffer is sized at runtime to the simulator's chosen viewport
// (web_display_resize), packed RGB565 (stride == width*2) as the simulator
// expects.

#include "display.h"

#include "canvas.h"
#include "display_present.h"

#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace {

gea::framework::graphics::Canvas g_canvas;
uint16_t *g_framebuffer = nullptr;
int g_brightness = 100;
int g_flush_rows = 0;
int g_flush_depth = 0;

}  // namespace

extern "C" {

int web_display_resize(int width, int height)
{
	if (width <= 0 || height <= 0) return 0;

	const size_t pixel_count = (size_t)width * (size_t)height;
	uint16_t *next = static_cast<uint16_t *>(std::realloc(g_framebuffer, pixel_count * sizeof(uint16_t)));
	if (!next) return 0;

	g_framebuffer = next;
	std::memset(g_framebuffer, 0, pixel_count * sizeof(uint16_t));
	g_canvas.bindPixels(g_framebuffer, width, height);
	return 1;
}

const uint16_t *web_display_pixels(void) { return g_canvas.pixels(); }
int web_display_width(void) { return g_canvas.width(); }
int web_display_height(void) { return g_canvas.height(); }
int web_display_stride_bytes(void) { return g_canvas.strideBytes(); }

}  // extern "C"

namespace gea::platform::display {

bool Display::init() { return true; }
bool Display::start() { return true; }

gea::framework::graphics::Canvas *Display::canvas() { return &g_canvas; }

// No panel transport: the browser presents the framebuffer by reading it each
// frame, so flush/present/stream have nothing to push.
void Display::clear() { g_canvas.clear(0x0000); }
void Display::clearNoFlush() { g_canvas.clear(0x0000); }
void Display::print(const char *) {}
void Display::flush() {}
void Display::flushRects(const DisplayFlushRect *, int, bool) {}
bool Display::streamRect(int, int, int, int, DisplayStreamRasterFn, void *) { return false; }

// Rasterize the recorded canvas-2d batch straight into the framebuffer the
// browser presents. The shared rasterizer (also behind the ESP32 flush-chunk
// present) replays the whole command list in one full-height "chunk" — the
// web framebuffer is packed, memory-resident, and read by JS after the frame,
// so there is nothing to window or DMA. Returning true consumes the batch:
// direct-canvas builds have no replay fallback, and tree builds skip the
// off-screen replay+flush for display-backed canvases.
bool Display::present(const DisplayPresentCommand *commands, int count)
{
	if (!g_framebuffer) return false;
	const int width = g_canvas.width();
	const int height = g_canvas.height();
	if (width <= 0 || height <= 0) return false;

	namespace present = gea::framework::display_present;
	// Reused across frames: extractFrame() clears it, so per-frame command
	// vectors don't reallocate at steady state.
	static present::Frame frame;
	if (!present::extractFrame(commands, count, frame)) return false;
	present::rasterFrameRows(g_framebuffer, 0, width, 0, height, height, frame);
	return true;
}

void Display::setFlushConfig(int chunk_rows, int queue_depth) { g_flush_rows = chunk_rows; g_flush_depth = queue_depth; }
void Display::setPresentScale(int /*scale*/) {}  // present-scale upscale is ESP32-only; no-op here
int Display::flushChunkRows() { return g_flush_rows; }
int Display::flushQueueDepth() { return g_flush_depth; }
int Display::flushBufferBytes() { return 0; }
DisplayFlushPerfStats Display::flushPerfStatsRead() { return {}; }

void Display::pushClip(int x, int y, int w, int h) { g_canvas.pushClip(x, y, w, h); }
void Display::popClip() { g_canvas.popClip(); }
void Display::resetClip() { g_canvas.resetClip(); }
void Display::setAlpha(uint8_t a) { g_canvas.setGlobalAlpha(a); }
uint8_t Display::alpha() { return g_canvas.globalAlpha(); }
int Display::brightness() { return g_brightness; }
void Display::setBrightness(int brightness_percent)
{
	if (brightness_percent < 0) brightness_percent = 0;
	if (brightness_percent > 100) brightness_percent = 100;
	g_brightness = brightness_percent;
}
// Tearing sync (TE/VBlank): not implemented on this target.
void Display::setVSync(bool) {}
void Display::invalidate() {}
bool Display::vsyncEnabled() { return false; }
void Display::vsyncWaitForFrame() {}
void Display::clip(int *x0, int *y0, int *x1, int *y1) { g_canvas.currentClip(x0, y0, x1, y1); }

void Display::fillRect(int x, int y, int w, int h, uint16_t color) { g_canvas.fillRect(x, y, w, h, color); }
void Display::scrollRect(int x, int y, int w, int h, int dx, int dy) { g_canvas.scrollRect(x, y, w, h, dx, dy); }
void Display::resetScrollRegion() {}
void Display::strokeRect(int x, int y, int w, int h, uint16_t color) { g_canvas.strokeRect(x, y, w, h, color); }
void Display::fillCircle(int cx, int cy, int r, uint16_t color) { g_canvas.fillCircle(cx, cy, r, color); }
void Display::strokeCircle(int cx, int cy, int r, uint16_t color) { g_canvas.strokeCircle(cx, cy, r, color); }
void Display::drawLine(int x0, int y0, int x1, int y1, uint16_t color) { g_canvas.drawLine(x0, y0, x1, y1, color); }
void Display::drawArc(int cx, int cy, int r, int start_deg, int end_deg, uint16_t color) { g_canvas.drawArc(cx, cy, r, start_deg, end_deg, color); }
void Display::fillTriangle(int x0, int y0, int x1, int y1, int x2, int y2, uint16_t color) { g_canvas.fillTriangle(x0, y0, x1, y1, x2, y2, color); }
void Display::drawText(const char *text, int x, int y, uint16_t color, float scale) { g_canvas.drawText(text, x, y, color, scale); }
void Display::drawTextFont(const char *text, int x, int y, uint16_t color, int font_id) { g_canvas.drawTextFont(text, x, y, color, font_id); }
void Display::drawTextFontFamily(const char *text, int x, int y, uint16_t color, int family_id, int size_px) { g_canvas.drawTextFontFamily(text, x, y, color, family_id, size_px); }
void Display::setPixel(int x, int y, uint16_t color) { g_canvas.fillRect(x, y, 1, 1, color); }
void Display::fillRoundedRect(int x, int y, int w, int h, int tl, int tr, int br, int bl, uint16_t color) { g_canvas.fillRoundedRect(x, y, w, h, tl, tr, br, bl, color); }
void Display::fillRoundedRectBoxesRgb565(const int16_t *xs, const int16_t *ys, int count, int w, int h, int tl, int tr, int br, int bl, const uint16_t *colors) { g_canvas.fillRoundedRectBoxesRgb565(xs, ys, count, w, h, tl, tr, br, bl, colors); }
void Display::strokeRoundedRect(int x, int y, int w, int h, int tl, int tr, int br, int bl, int lw, uint16_t color) { g_canvas.strokeRoundedRect(x, y, w, h, tl, tr, br, bl, lw, color); }
void Display::blitImage(const gea::framework::graphics::pixel::native_t *src, const uint8_t *alpha, int src_w, int src_h, int dx, int dy) { g_canvas.drawImage(src, alpha, src_w, src_h, dx, dy); }
void Display::blitImageScaled(const gea::framework::graphics::pixel::native_t *src, const uint8_t *alpha, int src_w, int src_h, int dx, int dy, int dst_w, int dst_h) { g_canvas.drawImage(src, alpha, src_w, src_h, dx, dy, dst_w, dst_h); }

// World-buffer overlay/scroll is a device compositing detail; the browser just
// presents the framebuffer, so these are no-ops here.
void Display::setWorldOverlay(const uint16_t *, int, int, int, int) {}
void Display::setWorldScroll(int) {}

}  // namespace gea::platform::display
