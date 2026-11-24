// Display for the web-skia target: the web target's framebuffer canvas, with
// software rasterization of the retained tree suppressed (the frame is
// presented as a display list, see skia_main.cpp). While a text capture is
// open, text the engine lays out is handed to the capture sink line by line.

#include "display.h"

#include "canvas.h"
#include "skia_display.h"
#include "ui/tree_internal.h"

#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace {

using pixel_t = gea::framework::graphics::pixel::native_t;

gea::framework::graphics::Canvas g_canvas;
pixel_t *g_framebuffer = nullptr;
int g_fb_width = 0;
int g_fb_height = 0;
int g_brightness = 100;
int g_flush_rows = 0;
int g_flush_depth = 0;

gea::web_skia::TextLineSink g_text_sink = nullptr;
void *g_text_user = nullptr;
int g_capture_clip[4] = {0, 0, -1, -1};

}  // namespace

namespace gea::web_skia {

void beginTextCapture(TextLineSink sink, void *user, int x0, int y0, int x1, int y1)
{
	g_text_sink = sink;
	g_text_user = user;
	g_capture_clip[0] = x0;
	g_capture_clip[1] = y0;
	g_capture_clip[2] = x1;
	g_capture_clip[3] = y1;
}

void endTextCapture()
{
	g_text_sink = nullptr;
	g_text_user = nullptr;
}

}  // namespace gea::web_skia

extern "C" {

int web_display_resize(int width, int height)
{
	if (width <= 0 || height <= 0) return 0;

	const size_t pixel_count = (size_t)width * (size_t)height;
	pixel_t *next = static_cast<pixel_t *>(std::realloc(g_framebuffer, pixel_count * sizeof(pixel_t)));
	if (!next) return 0;

	g_framebuffer = next;
	g_fb_width = width;
	g_fb_height = height;
	std::memset(g_framebuffer, 0, pixel_count * sizeof(pixel_t));
	g_canvas.bindPixels(g_framebuffer, width, height);
	gea::embedded::ui::Tree::instance().setSoftwareRasterSuppressed(true);
	return 1;
}

int web_display_width(void) { return g_canvas.width(); }
int web_display_height(void) { return g_canvas.height(); }

}  // extern "C"

namespace gea::platform::display {

bool Display::init() { return true; }
bool Display::start() { return true; }

gea::framework::graphics::Canvas *Display::canvas() { return &g_canvas; }

void Display::clear() { g_canvas.clear(0x0000); }
void Display::clearNoFlush() { g_canvas.clear(0x0000); }
void Display::print(const char *) {}
void Display::flush() {}
void Display::flushRects(const DisplayFlushRect *, int, bool) {}

bool Display::streamRect(int x, int y, int w, int h, DisplayStreamRasterFn raster, void *user)
{
	if (!raster || w <= 0 || h <= 0 || !g_framebuffer) return false;
	const int x0 = x < 0 ? 0 : x;
	const int y0 = y < 0 ? 0 : y;
	const int x1 = (x + w - 1) < g_fb_width - 1 ? (x + w - 1) : g_fb_width - 1;
	const int y1 = (y + h - 1) < g_fb_height - 1 ? (y + h - 1) : g_fb_height - 1;
	if (x0 > x1 || y0 > y1) return true;
	const int cw = x1 - x0 + 1;
	const int ch = y1 - y0 + 1;
	if (cw == g_fb_width) {
		raster(g_framebuffer + static_cast<size_t>(y0) * static_cast<size_t>(g_fb_width), cw, ch, x0, y0, user);
		return true;
	}
	static pixel_t *staging = nullptr;
	static size_t staging_capacity = 0;
	const size_t need = static_cast<size_t>(cw) * static_cast<size_t>(ch);
	if (need > staging_capacity) {
		pixel_t *next = static_cast<pixel_t *>(std::realloc(staging, need * sizeof(pixel_t)));
		if (!next) return false;
		staging = next;
		staging_capacity = need;
	}
	for (int row = 0; row < ch; ++row)
		std::memcpy(staging + static_cast<size_t>(row) * cw, g_framebuffer + static_cast<size_t>(y0 + row) * g_fb_width + x0, static_cast<size_t>(cw) * sizeof(pixel_t));
	raster(staging, cw, ch, x0, y0, user);
	for (int row = 0; row < ch; ++row)
		std::memcpy(g_framebuffer + static_cast<size_t>(y0 + row) * g_fb_width + x0, staging + static_cast<size_t>(row) * cw, static_cast<size_t>(cw) * sizeof(pixel_t));
	return true;
}

void Display::flushRectsRasterized(const DisplayFlushRect *rects, int count, DisplayStreamRasterFn raster, void *user, bool)
{
	if (!rects || count <= 0 || !raster) return;
	for (int i = 0; i < count; ++i) streamRect(rects[i].x0, rects[i].y0, rects[i].x1 - rects[i].x0 + 1, rects[i].y1 - rects[i].y0 + 1, raster, user);
	rebindCanvasToFramebuffer();
}

void Display::rebindCanvasToFramebuffer()
{
	if (!g_framebuffer) return;
	g_canvas.bindPixels(g_framebuffer, g_fb_width, g_fb_height);
}

bool Display::present(const DisplayPresentCommand *, int) { return false; }

void Display::setFlushConfig(int chunk_rows, int queue_depth) { g_flush_rows = chunk_rows; g_flush_depth = queue_depth; }
void Display::setPresentScale(int) {}
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
void Display::setVSync(bool) {}
void Display::invalidate() {}
bool Display::vsyncEnabled() { return false; }
void Display::vsyncWaitForFrame() {}
void Display::clip(int *x0, int *y0, int *x1, int *y1)
{
	if (!g_text_sink) {
		g_canvas.currentClip(x0, y0, x1, y1);
		return;
	}
	*x0 = g_capture_clip[0];
	*y0 = g_capture_clip[1];
	*x1 = g_capture_clip[2];
	*y1 = g_capture_clip[3];
}

void Display::fillRect(int x, int y, int w, int h, pixel_t color) { g_canvas.fillRect(x, y, w, h, color); }
void Display::scrollRect(int x, int y, int w, int h, int dx, int dy) { g_canvas.scrollRect(x, y, w, h, dx, dy); }
void Display::resetScrollRegion() {}
void Display::strokeRect(int x, int y, int w, int h, pixel_t color) { g_canvas.strokeRect(x, y, w, h, color); }
void Display::fillCircle(int cx, int cy, int r, pixel_t color) { g_canvas.fillCircle(cx, cy, r, color); }
void Display::strokeCircle(int cx, int cy, int r, pixel_t color) { g_canvas.strokeCircle(cx, cy, r, color); }
void Display::drawLine(int x0, int y0, int x1, int y1, pixel_t color) { g_canvas.drawLine(x0, y0, x1, y1, color); }
void Display::drawArc(int cx, int cy, int r, int start_deg, int end_deg, pixel_t color) { g_canvas.drawArc(cx, cy, r, start_deg, end_deg, color); }
void Display::fillTriangle(int x0, int y0, int x1, int y1, int x2, int y2, pixel_t color) { g_canvas.fillTriangle(x0, y0, x1, y1, x2, y2, color); }
void Display::drawText(const char *text, int x, int y, pixel_t color, float scale)
{
	if (!g_text_sink) g_canvas.drawText(text, x, y, color, scale);
}
void Display::drawTextFont(const char *text, int x, int y, pixel_t color, int font_id) { g_canvas.drawTextFont(text, x, y, color, font_id); }
void Display::drawTextFontFamily(const char *text, int x, int y, pixel_t color, int family_id, int size_px)
{
	if (g_text_sink) {
		g_text_sink(g_text_user, text, x, y, color, family_id, size_px);
		return;
	}
	g_canvas.drawTextFontFamily(text, x, y, color, family_id, size_px);
}
void Display::setPixel(int x, int y, pixel_t color) { g_canvas.fillRect(x, y, 1, 1, color); }
void Display::fillRoundedRect(int x, int y, int w, int h, int tl, int tr, int br, int bl, pixel_t color) { g_canvas.fillRoundedRect(x, y, w, h, tl, tr, br, bl, color); }
void Display::fillRoundedRectBoxesRgb565(const int16_t *xs, const int16_t *ys, int count, int w, int h, int tl, int tr, int br, int bl, const pixel_t *colors) { g_canvas.fillRoundedRectBoxesRgb565(xs, ys, count, w, h, tl, tr, br, bl, colors); }
void Display::strokeRoundedRect(int x, int y, int w, int h, int tl, int tr, int br, int bl, int lw, pixel_t color) { g_canvas.strokeRoundedRect(x, y, w, h, tl, tr, br, bl, lw, color); }
void Display::blitImage(const gea::framework::graphics::pixel::native_t *src, const uint8_t *alpha, int src_w, int src_h, int dx, int dy) { g_canvas.drawImage(src, alpha, src_w, src_h, dx, dy); }
void Display::blitImageScaled(const gea::framework::graphics::pixel::native_t *src, const uint8_t *alpha, int src_w, int src_h, int dx, int dy, int dst_w, int dst_h) { g_canvas.drawImage(src, alpha, src_w, src_h, dx, dy, dst_w, dst_h); }

void Display::setWorldOverlay(const uint16_t *, int, int, int, int) {}
void Display::setWorldScroll(int) {}

}  // namespace gea::platform::display
