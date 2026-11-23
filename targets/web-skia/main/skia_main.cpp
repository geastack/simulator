// Presents each frame as the Skia display list described in ../SKIA-TARGET.md.
// The list is a translation of the engine's retained display list (the same
// commands the pixel renderer replays), so paint order, overflow clips,
// scroll offsets and opacity are exactly the engine's. Text runs go through
// the engine's own line breaker and arrive here one positioned line at a time.

#include <emscripten/emscripten.h>

#include "display_present.h"
#include "display_underlay.h"
#include "graphics/font.h"
#include "image.h"
#include "pixel.h"
#include "skia_display.h"
#include "ui/canvas_element.h"
#include "ui/internal.h"
#include "ui/svg_element.h"
#include "ui/svg_geometry.h"
#include "ui/tree_internal.h"
#include "web_display.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

using gea::embedded::ui::CanvasRenderingContext2D;
using gea::embedded::ui::DisplayCommand;
using gea::embedded::ui::DisplayCommandType;
using gea::embedded::ui::DisplayList;
using gea::framework::graphics::FontRegistry;
using gea::framework::graphics::ImageStore;
using gea::framework::graphics::kImageMax;
using gea::embedded::ui::Tree;
using gea::framework::graphics::pixel::native_t;

enum Opcode : std::uint16_t {
	kSave = 1,
	kRestore = 2,
	kClipRect = 4,
	kClipRRect = 5,
	kFillRRect = 6,
	kBorder = 7,
	kTextLine = 8,
	kSaveLayerAlpha = 9,
	kImage = 10,
	kConcat = 11,
	kVertices = 12,
	kLinearGradient = 13,
	kRadialGradient = 14,
	kPath = 17,
	kSaveLayerBlur = 18,
};

constexpr std::uint32_t kMagic = 0x4C4B5347;
constexpr std::uint16_t kVersion = 1;
constexpr std::uint32_t kHeaderBytes = 48;
constexpr std::size_t kFlagsOffset = 6;
constexpr std::uint32_t kCanvasImage = 0x80000000u;

struct Rect {
	float left, top, right, bottom;
};

struct Radii {
	float tl, tr, br, bl;
};

// The matrix mapping `local` onto the screen quad (TL, TR, BR, BL), the
// inverse of the engine's screenToLocalRectHomography. Affine when the quad is
// a parallelogram within 1px (least-squares over the four corners), so a 2D
// rotation carries no perspective. False unless the quad is strictly convex.
bool rectToQuad(const Rect &local, const double *xs, const double *ys, double m[9])
{
	const double w = local.right - local.left, h = local.bottom - local.top;
	if (w <= 0 || h <= 0) return false;
	double turn = 0;
	for (int i = 0; i < 4; ++i) {
		const int j = (i + 1) % 4, k = (i + 2) % 4;
		const double cross = double(xs[j] - xs[i]) * (ys[k] - ys[j]) - double(ys[j] - ys[i]) * (xs[k] - xs[j]);
		if (cross == 0 || (turn != 0 && (cross > 0) != (turn > 0))) return false;
		turn = cross;
	}
	const double sx = xs[0] - xs[1] + xs[2] - xs[3], sy = ys[0] - ys[1] + ys[2] - ys[3];
	double a, b, c, d, e, f, g = 0, k = 0;
	if (std::fabs(sx) <= 1 && std::fabs(sy) <= 1) {
		a = (xs[1] - xs[0] + xs[2] - xs[3]) / 2.0;
		b = (xs[3] - xs[0] + xs[2] - xs[1]) / 2.0;
		d = (ys[1] - ys[0] + ys[2] - ys[3]) / 2.0;
		e = (ys[3] - ys[0] + ys[2] - ys[1]) / 2.0;
		c = (xs[0] + xs[1] + xs[2] + xs[3]) / 4.0 - (a + b) / 2;
		f = (ys[0] + ys[1] + ys[2] + ys[3]) / 4.0 - (d + e) / 2;
	} else {
		const double dx1 = xs[1] - xs[2], dx2 = xs[3] - xs[2], dy1 = ys[1] - ys[2], dy2 = ys[3] - ys[2];
		const double den = dx1 * dy2 - dx2 * dy1;
		g = (sx * dy2 - dx2 * sy) / den;
		k = (dx1 * sy - sx * dy1) / den;
		a = xs[1] - xs[0] + g * xs[1];
		b = xs[3] - xs[0] + k * xs[3];
		c = xs[0];
		d = ys[1] - ys[0] + g * ys[1];
		e = ys[3] - ys[0] + k * ys[3];
		f = ys[0];
	}
	const double u = local.left / w, v = local.top / h;
	const double out[9] = {a / w, b / h, c - a * u - b * v, d / w, e / h, f - d * u - e * v, g / w, k / h, 1 - g * u - k * v};
	for (int i = 0; i < 9; ++i) {
		if (!std::isfinite(out[i])) return false;
		m[i] = out[i];
	}
	return true;
}

bool facesAway(const int16_t *xs, const int16_t *ys)
{
	long area = 0;
	for (int i = 0; i < 4; ++i) area += long(xs[i]) * ys[(i + 1) % 4] - long(xs[(i + 1) % 4]) * ys[i];
	return area <= 0;
}

class ListWriter final : gea::framework::display::Underlay::Sink {
public:
	void build(std::vector<std::uint8_t> &out, int width, int height)
	{
		ops_.clear();
		strings_.clear();
		fonts_.clear();
		scopes_.clear();
		closed_ = {};
		alpha_ = 255;
		++frame_;
		scopes_.push_back({false, 0, 0, width - 1, height - 1, false, false, 255, 255, 0, 0});

		if (census_) census_.begin(width, height);
		const DisplayList &list = DisplayList::instance();
		const int count = list.commandCount();
		if (!covered(count > 0 ? list.commandAt(0) : nullptr, width, height)) {
			op(kFillRRect, 36);
			rect({0, 0, float(width), float(height)});
			radii({0, 0, 0, 0});
			u32(0xFF000000u);
		}
		underlay(width, height);
		for (int i = 0; i < count; ++i) {
			const DisplayCommand *command = list.commandAt(i);
			if (!command) continue;
			const std::size_t before = ops_.size();
			const bool visible = alpha_ != 0;
			convert(*command);
			if (ops_.size() > before) drew(*command);
			if (census_ && visible) census_.record(*command, ops_.size() != before, scopes_.back().x0, scopes_.back().y0, scopes_.back().x1, scopes_.back().y1);
		}
		while (scopes_.size() > 1) closeTop();
		finish(out, width, height);
		if (census_) census_.end();
	}

	// Per frame, the engine commands that produced no op (by type, with their
	// clipped bounding-box area) and the screen area covered by translated and
	// by skipped commands, and whether an underlay (a native layer painted under
	// the tree, e.g. gea3d) is registered and was translated (with its triangle
	// count). Off unless skia_census_enable(1).
	struct Census {
		static constexpr int kTypes = int(DisplayCommandType::DrawSvg) + 1;
		bool enabled = false;
		int width = 0, height = 0;
		int count[kTypes][2];
		std::uint64_t area[kTypes][2];
		static constexpr int kRetainedTypes = int(gea::platform::display::DisplayPresentCommandType::FillTrianglesRgb565) + 1;
		int retained[kRetainedTypes];
		std::vector<std::uint8_t> coverage;
		int underlayTriangles = -1;
		int svgGradients = 0;
		std::string report;

		explicit operator bool() const { return enabled; }

		void begin(int w, int h)
		{
			width = w;
			height = h;
			std::memset(count, 0, sizeof count);
			std::memset(area, 0, sizeof area);
			std::memset(retained, 0, sizeof retained);
			coverage.assign(std::size_t(w) * std::size_t(h), 0);
			underlayTriangles = -1;
			svgGradients = 0;
		}

		void underlay(int x0, int y0, int x1, int y1, int triangles)
		{
			underlayTriangles = triangles;
			for (int y = std::max(y0, 0); y <= std::min(y1, height - 1); ++y)
				for (int x = std::max(x0, 0); x <= std::min(x1, width - 1); ++x) coverage[std::size_t(y) * width + x] |= 1;
		}

		void record(const DisplayCommand &c, bool translated, int cx0, int cy0, int cx1, int cy1)
		{
			if (c.type == DisplayCommandType::PushClip || c.type == DisplayCommandType::PopClip || c.type == DisplayCommandType::SetAlpha ||
			    c.type == DisplayCommandType::ApplyFilterBlur)
				return;
			const int x0 = std::max({cx0, 0, int(c.bx)}), y0 = std::max({cy0, 0, int(c.by)});
			const int x1 = std::min({cx1, width - 1, c.bx + c.bw - 1}), y1 = std::min({cy1, height - 1, c.by + c.bh - 1});
			const std::uint8_t bit = translated ? 1 : 2;
			if (!translated) {
				const int clipText = c.textClipOwner >= 0 ? 1 : 0;
				count[int(c.type)][clipText]++;
				if (x1 >= x0 && y1 >= y0) area[int(c.type)][clipText] += std::uint64_t(x1 - x0 + 1) * std::uint64_t(y1 - y0 + 1);
			}
			for (int y = y0; y <= y1; ++y)
				for (std::uint8_t *p = &coverage[std::size_t(y) * width + x0], *e = p + (x1 - x0 + 1); p < e; ++p) *p |= bit;
		}

		void end()
		{
			static const char *const kNames[kTypes] = {"PushClip", "PopClip", "SetAlpha", "FillRect", "FillCircle", "FillRoundedRect",
			                                           "FillQuad", "FillLinearGradient", "FillRadialGradient", "DrawLine", "StrokeRect",
			                                           "StrokeRoundedRect", "DrawProjectedText", "DrawText", "BlitImage", "BlitImageScaled",
			                                           "BlitImageProjected", "ReplayCanvasBatch", "BeginFilterBlur", "ApplyFilterBlur",
			                                           "FillTransformedLinearGradient", "FillTransformedRoundedRect", "DrawSvg"};
			std::size_t translatedPx = 0, skippedPx = 0, skippedOnlyPx = 0;
			for (std::uint8_t v : coverage) {
				translatedPx += v & 1;
				skippedPx += v >> 1;
				skippedOnlyPx += v == 2;
			}
			using gea::framework::display::Underlay;
			const char *underlay = !Underlay::active()                         ? "none"
			                       : underlayTriangles >= 0                    ? "translated"
			                       : Underlay::covers(0, 0, width - 1, height - 1) ? "opaque-full"
			                                                                   : "active";
			report = std::string("underlay=") + underlay + (underlayTriangles >= 0 ? " underlayTriangles=" + std::to_string(underlayTriangles) : "") + " translatedPx=" + std::to_string(translatedPx) + " skippedPx=" + std::to_string(skippedPx) + " skippedOnlyPx=" +
			         std::to_string(skippedOnlyPx) + " framePx=" + std::to_string(coverage.size());
			for (int t = 0; t < kTypes; ++t)
				for (int k = 0; k < 2; ++k)
					if (count[t][k])
						report += std::string(" ") + kNames[t] + (k ? "(text-clip)" : "") + "=" + std::to_string(count[t][k]) + "/" + std::to_string(area[t][k]) + "px";
			static const char *const kRetainedNames[kRetainedTypes] = {"Clear", "FillRect", "StrokeRect", "FillTriangle", "FillCircle", "StrokeCircle", "FillCircles",
			                                                           "DrawImage", "DrawImageScaled", "DrawImageRotated90CW", "DrawImageTiledX", "FillText", "FillTriangles"};
			for (int t = 0; t < kRetainedTypes; ++t)
				if (retained[t]) report += std::string(" ReplayCanvasBatch.") + kRetainedNames[t] + "=" + std::to_string(retained[t]);
			if (svgGradients) report += " DrawSvg.gradientPaints=" + std::to_string(svgGradients);
		}
	};
	Census census_;

	struct CanvasImage {
		const native_t *pixels = nullptr;
		int width = 0, height = 0;
		std::uint32_t redraws = 0, generation = 0, seenAt = 0;
	};

	// The bitmap of a <canvas> in the last list, or null.
	const CanvasImage *canvasImage(int node) const
	{
		const auto found = canvases_.find(node);
		return found != canvases_.end() && found->second.seenAt == frame_ ? &found->second : nullptr;
	}

private:
	// The pixel target paints over a black framebuffer, so the list starts
	// black unless an opaque underlay or its first command (an <html> root's
	// canvas) already covers the viewport.
	static bool covered(const DisplayCommand *first, int width, int height)
	{
		if (gea::framework::display::Underlay::covers(0, 0, width - 1, height - 1)) return true;
		if (!first || first->type != DisplayCommandType::FillRect) return false;
		const auto &f = first->fill;
		int r = 0, g = 0, b = 0, a = 255;
		gea::framework::graphics::pixel::unpackNative8(f.color, &r, &g, &b, &a);
		return a == 255 && f.x <= 0 && f.y <= 0 && f.x + f.w >= width && f.y + f.h >= height;
	}

	// The engine's overflow clips and opacity groups, in canvas save order. A
	// clip that does not narrow the one in force is not emitted (the engine's
	// replay skips it too) and a scope that drew nothing is dropped. The engine
	// closes a node's opacity group just before popping its overflow clip, so a
	// closed group whose clip is still open is restored together with it.
	struct Scope {
		bool layer;
		int x0, y0, x1, y1;
		bool emitted;
		bool closing;
		std::uint8_t alpha, parentAlpha;
		std::size_t saveAt, contentAt;
		// A layer's drawn area, from its commands' bounding boxes; its
		// SaveLayerAlpha is narrowed to it on close, kLayerInkMargin wider for
		// glyph ink past a text command's box.
		int drawnX0 = 0, drawnY0 = 0, drawnX1 = -1, drawnY1 = -1;
		// The node of a filter: blur() layer, which is not an opacity group.
		int blurNode = -1;
	};
	static constexpr int kLayerInkMargin = 8;

	void pushClip(int x, int y, int w, int h)
	{
		const Scope &top = scopes_.back();
		Scope next{false, std::max(top.x0, x), std::max(top.y0, y), std::min(top.x1, x + w - 1), std::min(top.y1, y + h - 1), false, false, 0, 0, 0, 0};
		if (next.x0 != top.x0 || next.y0 != top.y0 || next.x1 != top.x1 || next.y1 != top.y1) {
			next.emitted = true;
			const std::size_t saveAt = ops_.size();
			op(kSave, 0);
			op(kClipRect, 16);
			rect({float(x), float(y), float(x + w), float(y + h)});
			const Head head = reopen(saveAt);
			next.saveAt = head.saveAt;
			next.contentAt = head.contentAt;
		}
		scopes_.push_back(next);
	}

	void popClip()
	{
		std::size_t clip = scopes_.size() - 1;
		while (clip > 0 && scopes_[clip].layer) --clip;
		if (clip == 0) return;
		while (scopes_.size() > clip) closeTop();
		closeClosingLayers();
	}

	void openLayer(std::uint8_t alpha, std::uint8_t parentAlpha)
	{
		Scope next = scopes_.back();
		next.layer = true;
		next.emitted = true;
		next.closing = false;
		next.alpha = alpha;
		next.parentAlpha = parentAlpha;
		next.blurNode = -1;
		next.drawnX0 = next.drawnY0 = 0;
		next.drawnX1 = next.drawnY1 = -1;
		next.saveAt = ops_.size();
		op(kSaveLayerAlpha, 20);
		rect({float(next.x0), float(next.y0), float(next.x1 + 1), float(next.y1 + 1)});
		f32(parentAlpha ? float(alpha) / float(parentAlpha) : 0.0f);
		next.contentAt = ops_.size();
		scopes_.push_back(next);
	}

	void setAlpha(const DisplayCommand &c)
	{
		alpha_ = c.alpha.alpha;
		if (c.alpha.nodeId >= 0) {
			if (c.alpha.alpha != c.alpha.recordParentAlpha) openLayer(c.alpha.alpha, c.alpha.recordParentAlpha);
			return;
		}
		Scope *layer = openLayerScope();
		if (!layer || c.alpha.alpha != layer->parentAlpha) return;
		layer->closing = true;
		closeClosingLayers();
	}

	Scope *openLayerScope()
	{
		for (std::size_t i = scopes_.size(); i-- > 1;)
			if (scopes_[i].layer && !scopes_[i].closing && scopes_[i].blurNode < 0) return &scopes_[i];
		return nullptr;
	}

	// The engine blurs a node's layer with kFilterBlurPasses (5) box blurs of
	// width 2r + 1 per axis (render.cpp blurLayerHorizontal/Vertical), whose
	// variance is 5 * ((2r + 1)^2 - 1) / 12: the Gaussian of the same variance.
	// A plain background leaf is blurred in its local space with the unscaled
	// radius and then projected (buildProjectedFilterBlurCache), so its sigma
	// is scaled by its box's projected size over its size (the mean of opposite
	// projected edges, as filterBlurScreenRadii measures them).
	void openBlur(const DisplayCommand &c)
	{
		const auto sigma = [](int r) { return r > 0 ? float(std::sqrt(5.0 * r * (r + 1) / 3.0)) : 0.0f; };
		const auto &f = c.filterBlur;
		float sx = sigma(f.radiusX), sy = sigma(f.radiusY);
		const auto &node = Tree::instance().nodes()[f.nodeId];
		if (f.sourceAlphaCap >= 0 && node.layout.width > 0 && node.layout.height > 0) {
			int16_t xs[4], ys[4];
			gea::embedded::ui::ViewRenderer::transformedCorners(node, false, xs, ys);
			const auto edge = [&](int i, int j) { return std::hypot(float(xs[j] - xs[i]), float(ys[j] - ys[i])); };
			sx = sigma(f.radius) * (edge(0, 1) + edge(3, 2)) / (2.0f * node.layout.width);
			sy = sigma(f.radius) * (edge(0, 3) + edge(1, 2)) / (2.0f * node.layout.height);
		}
		Scope next = scopes_.back();
		next.layer = true;
		next.emitted = true;
		next.closing = false;
		next.blurNode = f.nodeId;
		next.saveAt = ops_.size();
		op(kSaveLayerBlur, 24);
		rect({float(c.bx), float(c.by), float(c.bx + c.bw), float(c.by + c.bh)});
		f32(sx);
		f32(sy);
		next.contentAt = ops_.size();
		scopes_.push_back(next);
	}

	// Closed with the node's overflow clip when that is still open, as opacity is.
	void closeBlur(int node)
	{
		for (std::size_t i = scopes_.size(); i-- > 1;)
			if (scopes_[i].blurNode == node && !scopes_[i].closing) {
				scopes_[i].closing = true;
				break;
			}
		closeClosingLayers();
	}

	void closeClosingLayers()
	{
		while (scopes_.size() > 1 && scopes_.back().layer && scopes_.back().closing) closeTop();
	}

	void closeTop()
	{
		const Scope scope = scopes_.back();
		scopes_.pop_back();
		if (!scope.emitted) return;
		if (!scope.layer) {
			close({scope.saveAt, scope.contentAt});
			return;
		}
		if (ops_.size() == scope.contentAt) {
			ops_.resize(scope.saveAt);
			return;
		}
		if (scope.blurNode < 0 && foldLayer(scope.saveAt, scope.contentAt)) return;
		op(kRestore, 0);
		if (scope.blurNode < 0 && scope.drawnX0 <= scope.drawnX1 && scope.drawnY0 <= scope.drawnY1) {
			const float bounds[4] = {float(std::max(scope.x0, scope.drawnX0 - kLayerInkMargin)), float(std::max(scope.y0, scope.drawnY0 - kLayerInkMargin)),
			                         float(std::min(scope.x1, scope.drawnX1 + kLayerInkMargin) + 1),
			                         float(std::min(scope.y1, scope.drawnY1 + kLayerInkMargin) + 1)};
			std::memcpy(ops_.data() + scope.saveAt + 8, bounds, sizeof bounds);
		}
	}

	// An opacity layer holding a single one-coloured op is that op with its
	// colour's alpha scaled by the layer's.
	bool foldLayer(std::size_t saveAt, std::size_t contentAt)
	{
		std::uint16_t opcode;
		std::uint32_t size;
		std::memcpy(&opcode, ops_.data() + contentAt, 2);
		std::memcpy(&size, ops_.data() + contentAt + 4, 4);
		if (contentAt + size != ops_.size()) return false;
		std::size_t at = contentAt + 8;
		switch (opcode) {
		case kFillRRect: at += 32; break;
		case kTextLine: at += 16; break;
		default: return false;
		}
		float alpha;
		std::memcpy(&alpha, ops_.data() + saveAt + 8 + 16, 4);
		std::uint32_t color;
		std::memcpy(&color, ops_.data() + at, 4);
		color = (color & 0xFFFFFFu) | std::uint32_t(std::lround((color >> 24) * alpha)) << 24;
		std::memcpy(ops_.data() + at, &color, 4);
		std::memmove(ops_.data() + saveAt, ops_.data() + contentAt, size);
		ops_.resize(saveAt + size);
		return true;
	}

	void drew(const DisplayCommand &c)
	{
		if (c.type == DisplayCommandType::PushClip || c.type == DisplayCommandType::PopClip || c.type == DisplayCommandType::SetAlpha) return;
		for (Scope &scope : scopes_) {
			if (!scope.layer) continue;
			const bool empty = scope.drawnX0 > scope.drawnX1;
			scope.drawnX0 = empty ? c.bx : std::min(scope.drawnX0, int(c.bx));
			scope.drawnY0 = empty ? c.by : std::min(scope.drawnY0, int(c.by));
			scope.drawnX1 = empty ? c.bx + c.bw - 1 : std::max(scope.drawnX1, c.bx + c.bw - 1);
			scope.drawnY1 = empty ? c.by + c.bh - 1 : std::max(scope.drawnY1, c.by + c.bh - 1);
		}
	}

	void convert(const DisplayCommand &c)
	{
		switch (c.type) {
		case DisplayCommandType::PushClip:
			pushClip(c.clip.x, c.clip.y, c.clip.w, c.clip.h);
			return;
		case DisplayCommandType::PopClip:
			popClip();
			return;
		case DisplayCommandType::SetAlpha:
			setAlpha(c);
			return;
		case DisplayCommandType::BeginFilterBlur:
			if (c.filterBlur.radius > 0 && c.bw > 0 && c.bh > 0) openBlur(c);
			return;
		case DisplayCommandType::ApplyFilterBlur:
			closeBlur(c.filterBlur.nodeId);
			return;
		default:
			break;
		}
		if (c.textClipOwner >= 0 || alpha_ == 0) return;

		switch (c.type) {
		case DisplayCommandType::FillRect:
			fill({float(c.fill.x), float(c.fill.y), float(c.fill.x + c.fill.w), float(c.fill.y + c.fill.h)}, {0, 0, 0, 0}, c.fill.color);
			break;
		case DisplayCommandType::FillRoundedRect: {
			const auto &r = c.fillRoundedRect;
			fill({float(r.x), float(r.y), float(r.x + r.w), float(r.y + r.h)}, {float(r.tl), float(r.tr), float(r.br), float(r.bl)}, r.color);
			break;
		}
		case DisplayCommandType::FillCircle: {
			const auto &r = c.fillCircle;
			const float radius = r.r + 0.5f;
			fill({r.cx - r.r + 0.0f, r.cy - r.r + 0.0f, r.cx + r.r + 1.0f, r.cy + r.r + 1.0f}, {radius, radius, radius, radius}, r.color);
			break;
		}
		case DisplayCommandType::FillTransformedRoundedRect: {
			const auto &r = c.transformedRoundedRect;
			const Radii radii{std::min(r.tlRx8, r.tlRy8) / 8.0f, std::min(r.trRx8, r.trRy8) / 8.0f, std::min(r.brRx8, r.brRy8) / 8.0f,
			                  std::min(r.blRx8, r.blRy8) / 8.0f};
			if (r.x0 == r.x3 && r.x1 == r.x2 && r.y0 == r.y1 && r.y3 == r.y2 && r.x1 - r.x0 == r.lw && r.y3 - r.y0 == r.lh) {
				fill({float(r.x0), float(r.y0), float(r.x2), float(r.y2)}, radii, r.color);
				break;
			}
			const int16_t xs[4] = {r.x0, r.x1, r.x2, r.x3}, ys[4] = {r.y0, r.y1, r.y2, r.y3};
			const Rect local{float(r.lx), float(r.ly), float(r.lx + r.lw), float(r.ly + r.lh)};
			if (radii.tl == 0 && radii.tr == 0 && radii.br == 0 && radii.bl == 0)
				solidQuad(local, xs, ys, r.backfaceHidden, r.color);
			else
				transformed(local, xs, ys, r.backfaceHidden, [&] { fill(local, radii, r.color); });
			break;
		}
		case DisplayCommandType::FillQuad: {
			const auto &q = c.quad;
			if (q.x0 == q.x3 && q.x1 == q.x2 && q.y0 == q.y1 && q.y3 == q.y2) {
				fill({float(std::min(q.x0, q.x1)), float(std::min(q.y0, q.y3)), float(std::max(q.x0, q.x1)), float(std::max(q.y0, q.y3))}, {0, 0, 0, 0},
				     q.color);
				break;
			}
			const int16_t xs[4] = {q.x0, q.x1, q.x2, q.x3}, ys[4] = {q.y0, q.y1, q.y2, q.y3};
			const bool hasLocal = (q.reprojectMode == 1 || q.reprojectMode == 3) && q.lw > 0 && q.lh > 0;
			const Rect local = hasLocal ? Rect{float(q.lx), float(q.ly), float(q.lx + q.lw), float(q.ly + q.lh)} : Rect{0, 0, 1, 1};
			solidQuad(local, xs, ys, false, q.color);
			break;
		}
		case DisplayCommandType::FillLinearGradient: {
			const auto &g = c.gradient;
			const int limit = std::min(g.w / 2, g.h / 2);
			const auto radius = [limit](int value) { return float(std::clamp(value, 0, limit)); };
			linearStops(g.fromColor, g.midColor, g.toColor, g.fromAlpha, g.midAlpha, g.toAlpha, g.hasMid, g.midStop, g.toStop);
			linearGradient({float(g.x), float(g.y), float(g.x + g.w), float(g.y + g.h)}, {radius(g.tl), radius(g.tr), radius(g.br), radius(g.bl)}, g.angle);
			break;
		}
		case DisplayCommandType::FillTransformedLinearGradient: {
			const auto &g = c.transformedGradient;
			const int16_t xs[4] = {g.x0, g.x1, g.x2, g.x3}, ys[4] = {g.y0, g.y1, g.y2, g.y3};
			if (g.lw <= 0 || g.lh <= 0 || (g.backfaceHidden && facesAway(xs, ys))) break;
			const double fx[4] = {g.fx0 / 8.0, g.fx1 / 8.0, g.fx2 / 8.0, g.fx3 / 8.0}, fy[4] = {g.fy0 / 8.0, g.fy1 / 8.0, g.fy2 / 8.0, g.fy3 / 8.0};
			const Rect local{float(g.lx), float(g.ly), float(g.lx + g.lw), float(g.ly + g.lh)};
			transformed(local, fx, fy, [&] {
				linearStops(g.fromColor, g.midColor, g.toColor, g.fromAlpha, g.midAlpha, g.toAlpha, g.hasMid, g.midStop, g.toStop);
				linearGradient(local, {0, 0, 0, 0}, g.angle);
				if (g.edgeWidth && g.edgeAlpha) {
					int r = 0, gr = 0, b = 0, a = 0;
					gea::framework::graphics::pixel::unpackNative8(g.edgeColor, &r, &gr, &b, &a);
					borderArgb(local, {0, 0, 0, 0}, float(g.edgeWidth), argb(r, gr, b, g.edgeAlpha));
				}
			});
			break;
		}
		case DisplayCommandType::FillRadialGradient: {
			const auto &g = c.radialGradient;
			const int limit = std::min(g.w / 2, g.h / 2);
			const auto radius = [limit](int value) { return float(std::clamp(value, 0, limit)); };
			const Stop stops[2] = {{0, g.fromColor, g.fromAlpha}, {std::clamp<int>(g.stopPermille, 0, 1000) / 1000.0f, g.toColor, g.toAlpha}};
			gradientStops(stops, 2);
			radialGradient({float(g.x), float(g.y), float(g.x + g.w), float(g.y + g.h)}, {radius(g.tl), radius(g.tr), radius(g.br), radius(g.bl)},
			               g.x + g.w * (g.cxPermille / 1000.0f), g.y + g.h * (g.cyPermille / 1000.0f), std::max(1.0f, g.w * (g.rxPermille / 1000.0f)),
			               std::max(1.0f, g.h * (g.ryPermille / 1000.0f)));
			break;
		}
		case DisplayCommandType::StrokeRect: {
			const auto &s = c.stroke;
			border({float(s.x), float(s.y), float(s.x + s.w), float(s.y + s.h)}, {0, 0, 0, 0}, 1.0f, s.color);
			break;
		}
		case DisplayCommandType::StrokeRoundedRect: {
			const auto &s = c.strokeRoundedRect;
			const Radii radii = s.cssRadii ? Radii{std::min(s.rx8[0], s.ry8[0]) / 8.0f, std::min(s.rx8[1], s.ry8[1]) / 8.0f,
			                                       std::min(s.rx8[2], s.ry8[2]) / 8.0f, std::min(s.rx8[3], s.ry8[3]) / 8.0f}
			                               : Radii{float(s.tl), float(s.tr), float(s.br), float(s.bl)};
			border({float(s.x), float(s.y), float(s.x + s.w), float(s.y + s.h)}, radii, float(s.lineWidth), s.color);
			break;
		}
		case DisplayCommandType::DrawLine: {
			const auto &l = c.line;
			if (l.x0 == l.x1)
				fill({float(l.x0), float(std::min(l.y0, l.y1)), l.x0 + 1.0f, std::max(l.y0, l.y1) + 1.0f}, {0, 0, 0, 0}, l.color);
			else if (l.y0 == l.y1)
				fill({float(std::min(l.x0, l.x1)), float(l.y0), std::max(l.x0, l.x1) + 1.0f, l.y0 + 1.0f}, {0, 0, 0, 0}, l.color);
			break;
		}
		case DisplayCommandType::DrawText: {
			const auto &t = c.text;
			const Scope &clip = scopes_.back();
			gea::web_skia::beginTextCapture(&ListWriter::textLine, this, clip.x0, clip.y0, clip.x1, clip.y1);
			gea::embedded::ui::TextRenderer::drawWrapped(t.text, t.x, t.y, t.maxWidth, t.color, t.scale, t.align, t.containerWidth, t.fontId,
			                                             t.textTransform, t.lineHeight, t.whiteSpace, t.textOverflow, t.maxHeight,
			                                             t.firstLineIndent, t.fontWeight, t.fontStretch);
			gea::web_skia::endTextCapture();
			break;
		}
		case DisplayCommandType::DrawProjectedText: {
			const auto &p = c.projectedText;
			if (!p.text || p.alpha == 0 || p.srcW <= 0 || p.srcH <= 0) break;
			std::string storage;
			const char *text = gea::embedded::ui::TextRenderer::prepareText(p.text, p.textTransform, p.whiteSpace, storage);
			if (!text || !text[0]) break;
			const int16_t xs[4] = {p.x0, p.x1, p.x2, p.x3}, ys[4] = {p.y0, p.y1, p.y2, p.y3};
			transformed({float(p.srcX), float(p.srcY), float(p.srcX + p.srcW), float(p.srcY + p.srcH)}, xs, ys, p.backfaceHidden,
			            [&] { textLine(text, p.srcX, p.srcY, p.color, p.alpha, p.fontId, p.fontSize); });
			break;
		}
		case DisplayCommandType::BlitImage: {
			const auto &b = c.blit;
			image(b.pixels, b.alpha, b.sourceWidth, b.sourceHeight, {float(b.dx), float(b.dy), float(b.dx + b.sourceWidth), float(b.dy + b.sourceHeight)},
			      {0, 0, 0, 0});
			break;
		}
		case DisplayCommandType::BlitImageScaled: {
			const auto &b = c.scaledBlit;
			const float limit = float(std::min(b.dw, b.dh) / 2);
			image(b.pixels, b.alpha, b.sourceWidth, b.sourceHeight, {float(b.dx), float(b.dy), float(b.dx + b.dw), float(b.dy + b.dh)},
			      {std::min(float(std::max<int>(b.tl, 0)), limit), std::min(float(std::max<int>(b.tr, 0)), limit),
			       std::min(float(std::max<int>(b.br, 0)), limit), std::min(float(std::max<int>(b.bl, 0)), limit)});
			break;
		}
		case DisplayCommandType::ReplayCanvasBatch: {
			const auto &b = c.canvasBatch;
			retainedCanvas(b.nodeId, b.identity, b.x, b.y, b.width, b.height);
			break;
		}
#if GEA_UI_SVG
		case DisplayCommandType::DrawSvg:
			svgScene(c.svg.nodeId, c.svg.x, c.svg.y, c.svg.w, c.svg.h);
			break;
#endif
		case DisplayCommandType::BlitImageProjected: {
			const auto &b = c.projectedBlit;
			const Rect dst{float(b.x), float(b.y), float(b.x + b.width), float(b.y + b.height)};
			const float limit = std::min(b.width, b.height) / 2.0f;
			const Radii radii{std::min(float(std::max<int>(b.tl, 0)), limit), std::min(float(std::max<int>(b.tr, 0)), limit),
			                  std::min(float(std::max<int>(b.br, 0)), limit), std::min(float(std::max<int>(b.bl, 0)), limit)};
			transformed(dst, b.xs, b.ys, b.backfaceHidden, [&] { image(b.pixels, b.alpha, b.sourceWidth, b.sourceHeight, dst, radii); });
			break;
		}
		default:
			break;
		}
	}

	// The underlay (a gea3d scene) as Vertices ops ahead of the tree's ops: its
	// background as two triangles, then its primitives in painter's order, one
	// op per run of equal blend and alpha; clipped to its area when that is
	// not the whole viewport.
	void underlay(int width, int height)
	{
		viewport_[0] = width;
		viewport_[1] = height;
		triangles_ = 0;
		const std::size_t saveAt = ops_.size();
		if (!gea::framework::display::Underlay::describe(*this)) return;
		flushVertices();
		if (clipped_) {
			if (ops_.size() == underlayAt_)
				ops_.resize(saveAt);
			else
				op(kRestore, 0);
		}
		if (census_) census_.underlay(int(area_.left), int(area_.top), int(area_.right) - 1, int(area_.bottom) - 1, triangles_);
	}

	void area(int x0, int y0, int x1, int y1) override
	{
		area_ = {float(x0), float(y0), float(x1 + 1), float(y1 + 1)};
		clipped_ = x0 > 0 || y0 > 0 || x1 < viewport_[0] - 1 || y1 < viewport_[1] - 1;
		if (clipped_) {
			op(kSave, 0);
			op(kClipRect, 16);
			rect(area_);
		}
		underlayAt_ = ops_.size();
	}

	// Row r of n is lerp(top, bottom, r / (n - 1)) at its centre, so the
	// colours at the area's top and bottom edges extend that half a row.
	void background(std::uint32_t top, std::uint32_t bottom) override
	{
		const float rows = area_.bottom - area_.top;
		const auto at = [&](float y) {
			const float t = rows > 1 ? (y - area_.top - 0.5f) / (rows - 1) : 0.0f;
			std::uint32_t out = 0xFF000000u;
			for (int shift = 0; shift < 24; shift += 8) {
				const float a = float((top >> shift) & 0xFF), b = float((bottom >> shift) & 0xFF);
				out |= std::uint32_t(std::clamp(a + (b - a) * t + 0.5f, 0.0f, 255.0f)) << shift;
			}
			return out;
		};
		const std::uint32_t c0 = at(area_.top), c1 = at(area_.bottom);
		run(0, 255);
		vertex(area_.left, area_.top, c0);
		vertex(area_.right, area_.top, c0);
		vertex(area_.right, area_.bottom, c1);
		vertex(area_.left, area_.top, c0);
		vertex(area_.right, area_.bottom, c1);
		vertex(area_.left, area_.bottom, c1);
	}

	// A line covers one pixel per step along its major axis, from its first
	// end's pixel to its last's, and `width` pixels across: a parallelogram
	// reaching half a pixel past each end and sheared along the minor axis.
	void primitive(const gea::framework::display::Underlay::Primitive &p) override
	{
		using Primitive = gea::framework::display::Underlay::Primitive;
		run(p.blend, p.alpha);
		const std::uint32_t c0 = 0xFF000000u | p.color[0], c1 = 0xFF000000u | p.color[1];
		const float xa = p.x[0] / 16.0f, ya = p.y[0] / 16.0f, xb = p.x[1] / 16.0f, yb = p.y[1] / 16.0f;
		if (p.kind == Primitive::kTriangle) {
			vertex(xa, ya, c0);
			vertex(xb, yb, c1);
			vertex(p.x[2] / 16.0f, p.y[2] / 16.0f, 0xFF000000u | p.color[2]);
			return;
		}
		const float dx = xb - xa, dy = yb - ya;
		const bool xMajor = std::fabs(dx) >= std::fabs(dy);
		const float major = xMajor ? std::fabs(dx) : std::fabs(dy);
		const float ex = major > 0 ? dx * 0.5f / major : 0.5f, ey = major > 0 ? dy * 0.5f / major : 0.0f;
		const int across = std::max<int>(p.width, 1);
		const float lo = float(-((across - 1) >> 1)) - 0.5f, hi = lo + float(across);
		const float lx = xMajor ? 0 : lo, ly = xMajor ? lo : 0, hx = xMajor ? 0 : hi, hy = xMajor ? hi : 0;
		const float ax = xa - ex, ay = ya - ey, bx = xb + ex, by = yb + ey;
		vertex(ax + lx, ay + ly, c0);
		vertex(bx + lx, by + ly, c1);
		vertex(bx + hx, by + hy, c1);
		vertex(ax + lx, ay + ly, c0);
		vertex(bx + hx, by + hy, c1);
		vertex(ax + hx, ay + hy, c0);
	}

	void run(std::uint8_t blend, std::uint8_t alpha)
	{
		if (blend == runBlend_ && alpha == runAlpha_) return;
		flushVertices();
		runBlend_ = blend;
		runAlpha_ = alpha;
	}

	void vertex(float x, float y, std::uint32_t color)
	{
		positions_.push_back(x);
		positions_.push_back(y);
		colors_.push_back(color);
	}

	void flushVertices()
	{
		const std::size_t count = colors_.size();
		if (count) {
			op(kVertices, std::uint32_t(8 + count * 12));
			u32(std::uint32_t(count));
			u32(std::uint32_t(runBlend_) | std::uint32_t(runAlpha_) << 8);
			const std::size_t at = ops_.size();
			ops_.resize(at + count * 12);
			std::memcpy(ops_.data() + at, positions_.data(), count * 8);
			std::memcpy(ops_.data() + at + count * 8, colors_.data(), count * 4);
			triangles_ += int(count / 3);
		}
		positions_.clear();
		colors_.clear();
	}

	// Save, Concat (local rect onto the engine's projected corners), the
	// untransformed draw, Restore; nothing when the draw emits nothing. A
	// translation is applied to the draw's coordinates instead, and a matrix
	// equal to the one of the scope just closed reopens that scope.
	template <typename Draw>
	void transformed(const Rect &local, const int16_t *xs, const int16_t *ys, bool backfaceHidden, Draw draw)
	{
		if (backfaceHidden && facesAway(xs, ys)) return;
		const double x[4] = {double(xs[0]), double(xs[1]), double(xs[2]), double(xs[3])};
		const double y[4] = {double(ys[0]), double(ys[1]), double(ys[2]), double(ys[3])};
		transformed(local, x, y, draw);
	}

	template <typename Draw>
	void transformed(const Rect &local, const double *xs, const double *ys, Draw draw)
	{
		float m[9];
		if (!matrix(local, xs, ys, m)) return;
		if (m[0] == 1 && m[1] == 0 && m[3] == 0 && m[4] == 1 && m[6] == 0 && m[7] == 0 && m[8] == 1) {
			const std::size_t at = ops_.size();
			draw();
			shift(at, m[2], m[5]);
			return;
		}
		const std::size_t saveAt = ops_.size();
		op(kSave, 0);
		op(kConcat, 36);
		for (float value : m) f32(value);
		const Head head = reopen(saveAt);
		draw();
		close(head);
	}

	static bool matrix(const Rect &local, const double *xs, const double *ys, float out[9])
	{
		double m[9];
		if (!rectToQuad(local, xs, ys, m)) return false;
		for (int i = 0; i < 9; ++i) out[i] = float(m[i]);
		return true;
	}

	// A solid quad as a Path through the corners the Concat of `transformed`
	// would map `local` to, so the same pixels without a scope.
	void solidQuad(const Rect &local, const int16_t *xs, const int16_t *ys, bool backfaceHidden, native_t color)
	{
		if (backfaceHidden && facesAway(xs, ys)) return;
		const double x[4] = {double(xs[0]), double(xs[1]), double(xs[2]), double(xs[3])};
		const double y[4] = {double(ys[0]), double(ys[1]), double(ys[2]), double(ys[3])};
		float m[9];
		if (!matrix(local, x, y, m)) return;
		op(kPath, 12 + 4 + 4 * 8);
		u32(0);
		u32(argb(color));
		u32(1);
		u32(4);
		const float u[4] = {local.left, local.right, local.right, local.left}, v[4] = {local.top, local.top, local.bottom, local.bottom};
		for (int i = 0; i < 4; ++i) {
			const float w = m[6] * u[i] + m[7] * v[i] + m[8];
			f32((m[0] * u[i] + m[1] * v[i] + m[2]) / w);
			f32((m[3] * u[i] + m[4] * v[i] + m[5]) / w);
		}
	}

	// Moves the ops written since `at` by (dx, dy), as a Translate around them would.
	void shift(std::size_t at, float dx, float dy)
	{
		if (dx == 0 && dy == 0) return;
		const auto move = [&](std::size_t offset, int points) {
			for (int i = 0; i < points; ++i) {
				float p[2];
				std::memcpy(p, ops_.data() + offset + 8 * i, 8);
				p[0] += dx;
				p[1] += dy;
				std::memcpy(ops_.data() + offset + 8 * i, p, 8);
			}
		};
		while (at < ops_.size()) {
			std::uint16_t opcode;
			std::uint32_t size;
			std::memcpy(&opcode, ops_.data() + at, 2);
			std::memcpy(&size, ops_.data() + at + 4, 4);
			switch (opcode) {
			case kClipRRect:
			case kFillRRect:
			case kBorder:
			case kSaveLayerAlpha: move(at + 8, 2); break;
			case kLinearGradient:
				move(at + 8, 2);
				move(at + 8 + 32, 2);
				break;
			case kTextLine: move(at + 8, 1); break;
			case kImage: move(at + 8 + 24, 2); break;
			default: break;
			}
			at += size;
		}
	}

	// A Save scope whose head (the Save and its ClipRect or Concat) was just
	// written at `saveAt`. When the op before it is the Restore of a scope with
	// the same head, that scope is reopened instead: the state is the same.
	struct Head {
		std::size_t saveAt, contentAt;
	};

	Head reopen(std::size_t saveAt)
	{
		const std::size_t length = ops_.size() - saveAt;
		if (closed_.restoreAt + 8 == saveAt && closed_.contentAt - closed_.saveAt == length &&
		    std::memcmp(ops_.data() + closed_.saveAt, ops_.data() + saveAt, length) == 0) {
			ops_.resize(closed_.restoreAt);
			return {closed_.saveAt, closed_.contentAt};
		}
		return {saveAt, ops_.size()};
	}

	void close(const Head &head)
	{
		if (ops_.size() == head.contentAt) {
			ops_.resize(head.saveAt);
			return;
		}
		closed_ = {head.saveAt, head.contentAt, ops_.size()};
		op(kRestore, 0);
	}

	// ImageStore slots and <canvas> bitmaps are images; camera surfaces are not,
	// so their blits are skipped.
	void image(const native_t *pixels, const std::uint8_t *alpha, int width, int height, const Rect &dst, const Radii &radii)
	{
		if (width <= 0 || height <= 0 || dst.right <= dst.left || dst.bottom <= dst.top) return;
		std::uint32_t id = 0, gen = 0;
		const int stored = ImageStore::instance().idForPixels(pixels);
		if (stored >= 0) {
			id = std::uint32_t(stored);
			gen = generation(stored, pixels, alpha, width, height);
		} else if (!canvasImage(pixels, width, height, id, gen)) {
			return;
		}
		const int alpha8 = drawAlpha();
		if (alpha8 < 255) {
			op(kSaveLayerAlpha, 20);
			rect(dst);
			f32(alpha8 / 255.0f);
		}
		const bool rounded = radii.tl > 0 || radii.tr > 0 || radii.br > 0 || radii.bl > 0;
		if (rounded) {
			op(kSave, 0);
			op(kClipRRect, 32);
			rect(dst);
			this->radii(radii);
		}
		op(kImage, 40);
		u32(id);
		u32(gen);
		rect({0, 0, float(width), float(height)});
		rect(dst);
		if (rounded) op(kRestore, 0);
		if (alpha8 < 255) op(kRestore, 0);
	}

	// A <canvas> bitmap is image kCanvasImage | node. Its generation changes on
	// each frame the app redrew it (Tree::markCanvasDirty), and when its buffer,
	// size or presence in the list changed (a retained batch in between).
	bool canvasImage(const native_t *pixels, int width, int height, std::uint32_t &id, std::uint32_t &generation)
	{
		std::uint32_t redraws = 0;
		const int node = Tree::instance().canvasForPixels(pixels, &redraws);
		if (node < 0) return false;
		CanvasImage &state = canvases_[node];
		if (state.seenAt != frame_) {
			if (!state.generation || state.seenAt + 1 != frame_ || state.pixels != pixels || state.width != width || state.height != height ||
			    state.redraws != redraws)
				state.generation = ++generations_;
			state = {pixels, width, height, redraws, state.generation, frame_};
		}
		id = kCanvasImage | std::uint32_t(node);
		generation = state.generation;
		return true;
	}

	// A canvas batch the engine retained as commands instead of pixels
	// (CanvasRenderingContext2D::retainNumericBatch), in canvas coordinates under
	// the canvas's clip. Triangles are skipped.
	void retainedCanvas(int node, std::uint32_t identity, int x, int y, int width, int height)
	{
		const auto state = CanvasRenderingContext2D::stateFor(node);
		if (state->identity_ != identity || !state->retainedFrame_) return;
		pushClip(x, y, width, height);
		for (const auto &command : state->retainedFrame_->commands) retainedCommand(command, x, y, width, height);
		popClip();
	}

	void retainedCommand(const gea::framework::display_present::Command &command, int x, int y, int width, int height)
	{
		using Type = gea::platform::display::DisplayPresentCommandType;
		const auto color = [](native_t value, int alpha) {
			int r = 0, g = 0, b = 0, a = 255;
			gea::framework::graphics::pixel::unpackNative8(value, &r, &g, &b, &a);
			return gea::framework::graphics::pixel::packNative8(r, g, b, alpha);
		};
		const Rect box{float(x + command.x), float(y + command.y), float(x + command.x + command.w), float(y + command.y + command.h)};
		switch (command.type) {
		case Type::Clear:
			fill({float(x), float(y), float(x + width), float(y + height)}, {0, 0, 0, 0}, color(command.color, 255));
			return;
		case Type::FillRectRgb565:
			fill(box, {0, 0, 0, 0}, color(command.color, command.alpha));
			return;
		case Type::StrokeRectRgb565:
			border(box, {0, 0, 0, 0}, 1.0f, color(command.color, command.alpha));
			return;
		case Type::FillCircleRgb565:
		case Type::StrokeCircleRgb565:
			circle(x + command.x, y + command.y, command.radius, color(command.color, command.alpha), command.type == Type::StrokeCircleRgb565);
			return;
		case Type::FillCirclesRgb565: {
			const auto *circles = command.circleEntries();
			for (int i = 0; circles && i < command.circlesCount; ++i)
				circle(x + circles[i].x, y + circles[i].y, command.radius, color(circles[i].color, command.alpha), false);
			return;
		}
		default:
			if (census_) census_.retained[int(command.type)]++;
			return;
		}
	}

#if GEA_UI_SVG
	// The scene's items in paint order as Path ops in device pixels, clipped to
	// the svg box: fills with their fill rule, strokes as the engine's outline
	// pieces (all wound alike, so nonzero fills their union).
	void svgScene(int root, int x, int y, int width, int height)
	{
		pushClip(x, y, width, height);
		svgOrigin_[0] = float(x);
		svgOrigin_[1] = float(y);
		gea::embedded::ui::svg::visitScene(root, &ListWriter::svgPaint, this);
		popClip();
	}

	static void svgPaint(void *user, const gea::embedded::ui::svg::ScenePaint &paint) { static_cast<ListWriter *>(user)->svgPaint(paint); }

	void svgPaint(const gea::embedded::ui::svg::ScenePaint &paint)
	{
		if (paint.gradient) {
			if (census_) census_.svgGradients++;
			return;
		}
		int r = 0, g = 0, b = 0, a = 0;
		gea::framework::graphics::pixel::unpackNative8(native_t(paint.color), &r, &g, &b, &a);
		const std::uint32_t color = argb(r, g, b, int(std::lround(std::clamp(paint.alpha, 0.0f, 1.0f) * 255)));
		if (!(color >> 24)) return;
		if (!paint.stroke) {
			path(paint.geometry->contours, paint.evenOdd, color);
			return;
		}
		outline_.clear();
		gea::embedded::ui::svg::strokePath(*paint.geometry, *paint.stroke, outline_);
		path(outline_, false, color);
	}

	void path(const std::vector<gea::embedded::ui::svg::Contour> &contours, bool evenOdd, std::uint32_t color)
	{
		std::uint32_t count = 0, points = 0;
		for (const auto &contour : contours)
			if (contour.size() >= 3) ++count, points += std::uint32_t(contour.size());
		if (!count) return;
		op(kPath, 12 + 4 * count + 8 * points);
		u32(evenOdd ? 1 : 0);
		u32(color);
		u32(count);
		for (const auto &contour : contours) {
			if (contour.size() < 3) continue;
			u32(std::uint32_t(contour.size()));
			for (const auto &p : contour) {
				f32(p.x + svgOrigin_[0]);
				f32(p.y + svgOrigin_[1]);
			}
		}
	}

	float svgOrigin_[2] = {0, 0};
	std::vector<gea::embedded::ui::svg::Contour> outline_;
#endif

	void circle(int cx, int cy, int r, native_t color, bool stroke)
	{
		const Rect box{float(cx - r), float(cy - r), float(cx + r + 1), float(cy + r + 1)};
		const float radius = r + 0.5f;
		if (stroke)
			border(box, {radius, radius, radius, radius}, 1.0f, color);
		else
			fill(box, {radius, radius, radius, radius}, color);
	}

	// A new generation whenever the pixels behind `id` may differ from what the
	// host last read: hashed when the slot's buffer, size or presence in the
	// list changed, and every frame for GIFs and app-written buffers.
	std::uint32_t generation(int id, const native_t *pixels, const std::uint8_t *alpha, int width, int height)
	{
		ImageState &state = images_[id];
		if (state.seenAt == frame_) return state.generation;
		const ImageStore &store = ImageStore::instance();
		if (state.seenAt + 1 != frame_ || state.pixels != pixels || state.alpha != alpha || state.width != width || state.height != height ||
		    store.isAnimated(id) || store.pixelsMayChange(pixels)) {
			const std::uint64_t hash = hashImage(pixels, alpha, width, height);
			if (!state.generation || hash != state.hash) state.generation = ++generations_;
			state.hash = hash;
		}
		state.pixels = pixels;
		state.alpha = alpha;
		state.width = width;
		state.height = height;
		state.seenAt = frame_;
		return state.generation;
	}

	static std::uint64_t hashImage(const native_t *pixels, const std::uint8_t *alpha, int width, int height)
	{
		constexpr std::uint64_t kPrime = 0x100000001b3ull;
		std::uint64_t hash = 0xcbf29ce484222325ull ^ (std::uint64_t(width) << 32 | std::uint32_t(height));
		const std::size_t count = std::size_t(width) * std::size_t(height);
		for (std::size_t i = 0; i < count; ++i) hash = (hash ^ pixels[i]) * kPrime;
		if (alpha)
			for (std::size_t i = 0; i < count; ++i) hash = (hash ^ alpha[i]) * kPrime;
		return hash;
	}

	static void textLine(void *user, const char *text, int x, int top, native_t color, int familyId, int sizePx)
	{
		static_cast<ListWriter *>(user)->textLine(text, x, top, color, 255, familyId, sizePx);
	}

	void textLine(const char *text, int x, int top, native_t color, int alpha, int familyId, int sizePx)
	{
		const auto font = FontRegistry::rasterizedFamily(familyId, sizePx);
		const int ascender = font.valid() ? font.ascender() : sizePx;
		const int size = font.valid() ? font.sizePx() : sizePx;
		std::uint32_t value = argb(color);
		value = (value & 0xFFFFFF) | (((value >> 24) * std::uint32_t(alpha) / 255) << 24);
		useFont(familyId);
		op(kTextLine, 28);
		f32(float(x));
		f32(float(top + ascender));
		u32(std::uint32_t(familyId));
		f32(float(size));
		u32(value);
		string(text, std::strlen(text));
	}

	void fill(const Rect &r, const Radii &radii, native_t color)
	{
		if (r.right <= r.left || r.bottom <= r.top) return;
		op(kFillRRect, 36);
		rect(r);
		this->radii(radii);
		u32(argb(color));
	}

	void border(const Rect &r, const Radii &radii, float width, native_t color) { borderArgb(r, radii, width, argb(color)); }

	void borderArgb(const Rect &r, const Radii &radii, float width, std::uint32_t argbColor)
	{
		if (r.right <= r.left || r.bottom <= r.top || width <= 0) return;
		op(kBorder, 64);
		rect(r);
		this->radii(radii);
		for (int i = 0; i < 4; ++i) f32(width);
		for (int i = 0; i < 4; ++i) u32(argbColor);
	}

	struct Stop {
		float offset;
		native_t color;
		std::uint8_t alpha;
	};

	void linearStops(native_t from, native_t mid, native_t to, std::uint8_t fromAlpha, std::uint8_t midAlpha, std::uint8_t toAlpha, bool hasMid, int midStop,
	                 int toStop)
	{
		toStop = toStop > 0 ? toStop : 1000;
		const Stop stops[3] = {{0, from, fromAlpha}, {midStop / 1000.0f, mid, midAlpha}, {toStop / 1000.0f, to, toAlpha}};
		if (hasMid && midStop > 0 && midStop < toStop) {
			gradientStops(stops, 3);
		} else {
			const Stop ends[2] = {stops[0], stops[2]};
			gradientStops(ends, 2);
		}
	}

	// The engine interpolates gradient colours premultiplied
	// (LinearGradientDrawer::interpolatePremultipliedRgb888), Skia unpremultiplied.
	// So a transparent end takes the other end's colour, and a run between two
	// different alphas gets stops sampled from the engine's curve until Skia's
	// lines stay within half a level of it. A run past offset 1 is cut there.
	void gradientStops(const Stop *stops, int count)
	{
		gradient_.clear();
		for (int i = 0; i + 1 < count; ++i) {
			const Stop &from = stops[i], &to = stops[i + 1];
			if (from.offset >= 1 && !gradient_.empty()) break;
			double c0[3], c1[3];
			unpack(from.color, c0);
			unpack(to.color, c1);
			const double a0 = from.alpha, a1 = to.alpha;
			const double end = to.offset > 1 ? (1 - from.offset) / (to.offset - from.offset) : 1;
			const auto at = [&](double t, double out[3]) {
				const double w0 = a0 * (1 - t), w1 = a1 * t;
				for (int k = 0; k < 3; ++k) out[k] = w0 + w1 > 0 ? (c0[k] * w0 + c1[k] * w1) / (w0 + w1) : (a0 == 0 ? c1[k] : c0[k]);
				return a0 + (a1 - a0) * t;
			};
			int n = 1;
			while (a0 != a1 && a0 > 0 && a1 > 0 && n < 64) {
				double error = 0;
				for (int k = 0; k < n; ++k) {
					double lo[3], hi[3], mid[3];
					at(end * k / n, lo);
					at(end * (k + 1) / n, hi);
					const double alpha = at(end * (k + 0.5) / n, mid);
					for (int j = 0; j < 3; ++j) error = std::max(error, std::fabs(mid[j] - (lo[j] + hi[j]) / 2) * alpha / 255);
				}
				if (error <= 0.5) break;
				n *= 2;
			}
			for (int k = 0; k <= n; ++k) {
				const double t = end * k / n;
				double rgb[3];
				const double alpha = at(t, rgb);
				if (alpha == 0) unpack(k == 0 ? to.color : from.color, rgb);
				const std::uint32_t color = argb(int(rgb[0] + 0.5), int(rgb[1] + 0.5), int(rgb[2] + 0.5), int(alpha + 0.5));
				const float offset = float(from.offset + (to.offset - from.offset) * t);
				if (!gradient_.empty() && gradient_.back().first == offset && gradient_.back().second == color) continue;
				gradient_.emplace_back(offset, color);
			}
		}
		if (std::all_of(gradient_.begin(), gradient_.end(), [](const auto &stop) { return stop.second >> 24 == 0; })) gradient_.clear();
	}

	static void unpack(native_t color, double rgb[3])
	{
		int r = 0, g = 0, b = 0, a = 0;
		gea::framework::graphics::pixel::unpackNative8(color, &r, &g, &b, &a);
		rgb[0] = r;
		rgb[1] = g;
		rgb[2] = b;
	}

	// The gradient line of a CSS angle (tenths of a degree, 0 = to top) through
	// the rect's centre, as long as the rect's extent along it; angles on an axis
	// are exact, as in LinearGradientDrawer::replay.
	void linearGradient(const Rect &r, const Radii &radii, int angle)
	{
		if (r.right <= r.left || r.bottom <= r.top || gradient_.empty()) return;
		double dx = std::sin(angle * 3.14159265358979323846 / 1800.0), dy = -std::cos(angle * 3.14159265358979323846 / 1800.0);
		switch (angle % 3600) {
		case 0: dx = 0, dy = -1; break;
		case 900: dx = 1, dy = 0; break;
		case 1800: dx = 0, dy = 1; break;
		case 2700: dx = -1, dy = 0; break;
		default: break;
		}
		const double half = (std::fabs(dx) * (r.right - r.left) + std::fabs(dy) * (r.bottom - r.top)) / 2;
		const double cx = (r.left + r.right) / 2.0, cy = (r.top + r.bottom) / 2.0;
		op(kLinearGradient, std::uint32_t(52 + 8 * gradient_.size()));
		rect(r);
		this->radii(radii);
		f32(float(cx - dx * half));
		f32(float(cy - dy * half));
		f32(float(cx + dx * half));
		f32(float(cy + dy * half));
		stops();
	}

	void radialGradient(const Rect &r, const Radii &radii, float cx, float cy, float rx, float ry)
	{
		if (r.right <= r.left || r.bottom <= r.top || gradient_.empty()) return;
		op(kRadialGradient, std::uint32_t(52 + 8 * gradient_.size()));
		rect(r);
		this->radii(radii);
		f32(cx);
		f32(cy);
		f32(rx);
		f32(ry);
		stops();
	}

	void stops()
	{
		u32(std::uint32_t(gradient_.size()));
		for (const auto &stop : gradient_) {
			f32(stop.first);
			u32(stop.second);
		}
	}

	std::uint32_t argb(native_t color)
	{
		int r = 0, g = 0, b = 0, a = 255;
		gea::framework::graphics::pixel::unpackNative8(color, &r, &g, &b, &a);
		return argb(r, g, b, a);
	}

	std::uint32_t argb(int r, int g, int b, int a)
	{
		a = a * drawAlpha() / 255;
		return (std::uint32_t(a) << 24) | (std::uint32_t(r) << 16) | (std::uint32_t(g) << 8) | std::uint32_t(b);
	}

	// The engine's current alpha relative to the open opacity layer, which
	// already applies the rest.
	int drawAlpha()
	{
		const Scope *layer = openLayerScope();
		const int groupAlpha = layer ? layer->alpha : 255;
		return groupAlpha ? std::min(255, alpha_ * 255 / groupAlpha) : 0;
	}

	void useFont(int familyId)
	{
		if (std::find(fonts_.begin(), fonts_.end(), familyId) == fonts_.end()) fonts_.push_back(familyId);
	}

	void op(std::uint16_t opcode, std::uint32_t payload)
	{
		u32(opcode);
		u32(8 + payload);
	}

	void rect(const Rect &r)
	{
		f32(r.left);
		f32(r.top);
		f32(r.right);
		f32(r.bottom);
	}

	void radii(const Radii &r)
	{
		f32(r.tl);
		f32(r.tr);
		f32(r.br);
		f32(r.bl);
	}

	void string(const char *text, std::size_t length)
	{
		u32(std::uint32_t(strings_.size()));
		u32(std::uint32_t(length));
		strings_.append(text, length);
	}

	void u32(std::uint32_t value) { put(ops_, value); }
	void f32(float value)
	{
		std::uint32_t bits;
		std::memcpy(&bits, &value, sizeof bits);
		put(ops_, bits);
	}

	static void put(std::vector<std::uint8_t> &out, std::uint32_t value)
	{
		const std::uint8_t bytes[4] = {std::uint8_t(value), std::uint8_t(value >> 8), std::uint8_t(value >> 16), std::uint8_t(value >> 24)};
		out.insert(out.end(), bytes, bytes + 4);
	}

	void finish(std::vector<std::uint8_t> &out, int width, int height)
	{
		std::vector<std::string> names;
		for (int id : fonts_) {
			const char *family = FontRegistry::familyName(id);
			names.push_back(std::string(family ? family : "") + ".ttf");
		}
		const std::size_t stringsStart = strings_.size();
		for (const auto &name : names) strings_ += name;
		while (strings_.size() % 4) strings_.push_back('\0');
		const std::uint32_t opsOffset = kHeaderBytes;
		const std::uint32_t stringsOffset = opsOffset + std::uint32_t(ops_.size());
		const std::uint32_t fontsOffset = stringsOffset + std::uint32_t(strings_.size());

		out.clear();
		put(out, kMagic);
		put(out, kVersion);
		put(out, std::uint32_t(width));
		put(out, std::uint32_t(height));
		put(out, opsOffset);
		put(out, std::uint32_t(ops_.size()));
		put(out, stringsOffset);
		put(out, std::uint32_t(strings_.size()));
		put(out, fontsOffset);
		put(out, std::uint32_t(fonts_.size()));
		put(out, 0);
		put(out, 0);
		out.insert(out.end(), ops_.begin(), ops_.end());
		out.insert(out.end(), strings_.begin(), strings_.end());
		std::size_t nameOffset = stringsStart;
		for (std::size_t i = 0; i < fonts_.size(); ++i) {
			put(out, std::uint32_t(fonts_[i]));
			put(out, std::uint32_t(nameOffset));
			put(out, std::uint32_t(names[i].size()));
			put(out, 0);
			nameOffset += names[i].size();
		}
	}

	std::vector<std::uint8_t> ops_;
	std::string strings_;
	std::vector<int> fonts_;
	std::vector<Scope> scopes_;
	struct Closed {
		std::size_t saveAt = 0, contentAt = 0, restoreAt = 0;
	} closed_;
	std::uint8_t alpha_ = 255;
	std::vector<std::pair<float, std::uint32_t>> gradient_;

	int viewport_[2] = {0, 0};
	Rect area_{0, 0, 0, 0};
	bool clipped_ = false;
	std::size_t underlayAt_ = 0;
	std::uint8_t runBlend_ = 0, runAlpha_ = 255;
	std::vector<float> positions_;
	std::vector<std::uint32_t> colors_;
	int triangles_ = 0;

	struct ImageState {
		const native_t *pixels = nullptr;
		const std::uint8_t *alpha = nullptr;
		int width = 0, height = 0;
		std::uint64_t hash = 0;
		std::uint32_t generation = 0;
		std::uint32_t seenAt = 0;
	};
	ImageState images_[kImageMax];
	std::unordered_map<int, CanvasImage> canvases_;
	std::uint32_t frame_ = 0;
	std::uint32_t generations_ = 0;
};

ListWriter g_writer;
std::vector<std::uint8_t> g_list;
std::vector<std::uint8_t> g_next;
std::vector<std::uint32_t> g_imagePixels;

void buildList()
{
	g_writer.build(g_next, web_display_width(), web_display_height());
	const bool same = g_next.size() == g_list.size() &&
	                  std::memcmp(g_next.data(), g_list.data(), kFlagsOffset) == 0 &&
	                  std::memcmp(g_next.data() + kFlagsOffset + 2, g_list.data() + kFlagsOffset + 2, g_next.size() - kFlagsOffset - 2) == 0;
	g_list.swap(g_next);
	g_list[kFlagsOffset] = same ? 1 : 0;
}

}  // namespace

extern "C" {

void web_target_frame_end(void) { buildList(); }

EMSCRIPTEN_KEEPALIVE
const std::uint8_t *get_skia_list_ptr(void)
{
	return g_list.empty() ? nullptr : g_list.data();
}

EMSCRIPTEN_KEEPALIVE
int get_skia_list_size(void)
{
	return static_cast<int>(g_list.size());
}

EMSCRIPTEN_KEEPALIVE
const std::uint8_t *skia_image_pixels(int imageId)
{
	const native_t *pixels = nullptr;
	const std::uint8_t *alpha = nullptr;
	std::size_t count = 0;
	if (imageId < 0) {
		if (const auto *canvas = g_writer.canvasImage(imageId & ~kCanvasImage)) {
			pixels = canvas->pixels;
			count = std::size_t(canvas->width) * std::size_t(canvas->height);
		}
	} else {
		const ImageStore &store = ImageStore::instance();
		pixels = store.currentPixels(imageId);
		alpha = store.currentAlpha(imageId);
		count = std::size_t(std::max(store.width(imageId), 0)) * std::size_t(std::max(store.height(imageId), 0));
	}
	if (!pixels || count == 0) return nullptr;
	g_imagePixels.resize(count);
#if GEA_EMBEDDED_PIXEL_FORMAT == GEA_PIXEL_RGBA8888
	// A native pixel already holds R, G, B, A in memory order; only A is replaced.
	std::uint32_t *out = g_imagePixels.data();
	if (alpha)
		for (std::size_t i = 0; i < count; ++i) out[i] = (pixels[i] & 0x00FFFFFFu) | std::uint32_t(alpha[i]) << 24;
	else
		for (std::size_t i = 0; i < count; ++i) out[i] = pixels[i] | 0xFF000000u;
#else
	std::uint8_t *out = reinterpret_cast<std::uint8_t *>(g_imagePixels.data());
	for (std::size_t i = 0; i < count; ++i, out += 4) {
		int r = 0, g = 0, b = 0, a = 255;
		gea::framework::graphics::pixel::unpackNative8(pixels[i], &r, &g, &b, &a);
		out[0] = std::uint8_t(r);
		out[1] = std::uint8_t(g);
		out[2] = std::uint8_t(b);
		out[3] = alpha ? alpha[i] : 255;
	}
#endif
	return reinterpret_cast<const std::uint8_t *>(g_imagePixels.data());
}

EMSCRIPTEN_KEEPALIVE
void skia_census_enable(int enabled)
{
	g_writer.census_.enabled = enabled != 0;
}

EMSCRIPTEN_KEEPALIVE
const char *get_skia_census(void)
{
	return g_writer.census_.report.c_str();
}

EMSCRIPTEN_KEEPALIVE
int skia_image_width(int imageId)
{
	if (imageId < 0) {
		const auto *canvas = g_writer.canvasImage(imageId & ~kCanvasImage);
		return canvas ? canvas->width : 0;
	}
	return ImageStore::instance().width(imageId);
}

EMSCRIPTEN_KEEPALIVE
int skia_image_height(int imageId)
{
	if (imageId < 0) {
		const auto *canvas = g_writer.canvasImage(imageId & ~kCanvasImage);
		return canvas ? canvas->height : 0;
	}
	return ImageStore::instance().height(imageId);
}

}  // extern "C"
