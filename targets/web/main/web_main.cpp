#include <stdint.h>

#include <cmath>

#include <emscripten/emscripten.h>

#include "app.h"
#include "css/declarative.h"
#include "css/engine.h"
#include "events.h"
#include "host/storage.h"
#include "services/storage_service.h"
#include "touch.h"
#include "ui/style.h"
#include "ui/tree_internal.h"
#include "web_display.h"

// Pointer event types shared with the simulator (see
// simulator/src/app-runtime.ts: APP_POINTER_DOWN/MOVE/UP/CLICK).
enum {
	WEB_POINTER_DOWN = 1,
	WEB_POINTER_MOVE = 2,
	WEB_POINTER_UP = 3,
	WEB_POINTER_CLICK = 4,
};

static bool g_css_animations_started = false;
static bool g_storage_loaded = false;

static double normalize_device_pixel_ratio(double devicePixelRatio)
{
	if (!std::isfinite(devicePixelRatio)) return GEA_EMBEDDED_CSS_DEVICE_PIXEL_RATIO;
	if (devicePixelRatio < 1.0) return 1.0;
	// 3 was a screen-density ceiling, and it is the wrong ceiling for a
	// simulator: a page that renders a panel into twice the pixels and displays
	// it at the panel's own size is SUPERSAMPLING, not claiming a 4x display,
	// and the ratio it needs is the panel's own ratio times the oversample. A
	// pedal whose UI is laid out at cssDevicePixelRatio 2 wants 4 to draw at 2x,
	// and clamping that to 3 silently re-laid the whole UI at a third more
	// points -- everything smaller, nothing filling its frame, and no error.
	if (devicePixelRatio > 8.0) return 8.0;
	return devicePixelRatio;
}

static void drive_css_animations(int timestamp_ms)
{
	const uint32_t now_ms = static_cast<uint32_t>(timestamp_ms);
	if (!g_css_animations_started) {
		gea::css::DeclarativeAnimations::scanAndStart(now_ms);
		gea::embedded::ui::StyleSheet::instance().startCssAnimations(now_ms);
		g_css_animations_started = true;
	}
	gea::css::AnimationEngine::instance().tick(now_ms);
}

// extern "C" so emscripten can export the unmangled names (EXPORTED_FUNCTIONS
// lists `_app_init` etc.) and so the web_display_* calls bind to web_display.cpp's
// C-linkage definitions. The bodies still call into the C++ runtime/UI.
extern "C" {

EMSCRIPTEN_KEEPALIVE
int app_init(int width, int height, double devicePixelRatio)
{
	if (width <= 0 || height <= 0) return 1;
	if (!web_display_resize(width, height)) return 2;

		const double normalizedDevicePixelRatio = normalize_device_pixel_ratio(devicePixelRatio);
	if (!g_storage_loaded) {
		if (!gea::framework::services::StorageService::init()) return 3;
		gea::host::Storage.load();
		g_storage_loaded = true;
	}
	gea::framework::app::Application::init(width, height, normalizedDevicePixelRatio);
	g_css_animations_started = false;
	return 0;
}

EMSCRIPTEN_KEEPALIVE
void app_frame(int timestampMs)
{
	drive_css_animations(timestampMs);
	gea::framework::app::Application::frame(timestampMs);
	gea::host::Storage.flushPending();
}

EMSCRIPTEN_KEEPALIVE
void app_dispatch_key_down(int keyCode)
{
	using gea::framework::events::PointerEvent;
	using gea::framework::events::PointerEventType;

	auto &tree = gea::embedded::ui::Tree::instance();
	int targetId = tree.activeInputId();
	if (targetId < 0) {
		targetId = tree.mountedRoot();
		if (targetId >= 0) {
			const int appRoot = tree.firstChildOf(targetId);
			if (appRoot >= 0) targetId = appRoot;
		}
	}
	if (targetId < 0) return;

	PointerEvent event{};
	event.type = PointerEventType::KeyDown;
	event.targetId = targetId;
	event.currentTargetId = targetId;
	event.keyCode = keyCode;
	event.bubbles = true;
	event.cancelable = true;
	tree.dispatchEvent(event);
}

// Return the hit NODE id (not Tree::hitTest's press id). app_dispatch_pointer_event
// feeds this to Tree::dispatchEvent, which requires a node id as targetId and
// bubbles up to the node carrying the onClick/onPress handler (browser model).
EMSCRIPTEN_KEEPALIVE
int app_hit_test(int x, int y)
{
	return gea::embedded::ui::Tree::instance().hitTestNode(x, y);
}

EMSCRIPTEN_KEEPALIVE
void app_touch_down(int x, int y)
{
	gea::platform::touch::Touchscreen::injectEvent(gea::platform::touch::Phase::Down, true, x, y);
	gea::embedded::ui::Tree::instance().pointerDown(x, y);
}

EMSCRIPTEN_KEEPALIVE
int app_touch_up(void)
{
	int x = 0;
	int y = 0;
	gea::platform::touch::Touchscreen::readCached(&x, &y);
	gea::platform::touch::Touchscreen::injectEvent(gea::platform::touch::Phase::Up, false, x, y);
	return gea::embedded::ui::Tree::instance().pointerUp();
}

EMSCRIPTEN_KEEPALIVE
void app_touch_move(int x, int y)
{
	gea::platform::touch::Touchscreen::injectEvent(gea::platform::touch::Phase::Move, true, x, y);
	gea::embedded::ui::Tree::instance().pointerMove(x, y);
}

// Dispatch a node-targeted event to the hit-tested node (press_id), mirroring
// the macOS host (press_bridge.mm). JSX onClick/onPress handlers are delivered
// through Tree::dispatchEvent on the target node, NOT through coordinate
// pointerDown/pointerUp (which only drive low-level press state for canvas/game
// apps). The simulator supplies press_id from app_hit_test.
EMSCRIPTEN_KEEPALIVE
void app_dispatch_pointer_event(int event_type, int press_id, int x, int y)
{
	using gea::framework::events::PointerEvent;
	using gea::framework::events::PointerEventType;
	if (press_id < 0) return;
	auto &tree = gea::embedded::ui::Tree::instance();
	if (press_id >= tree.nodeCount()) return;

	// Web convention (matches touch_runtime.cpp): the primary pointer is id 1.
	// Populate every coordinate field — apps read clientX/clientY (the DOM name),
	// not just x/y, so leaving those at 0 silently zeroes pan/pinch deltas.
	auto fire = [&](PointerEventType type) {
		PointerEvent ev;
		ev.type = type;
		ev.targetId = press_id;
		ev.pointerId = 1;
		ev.x = x;
		ev.y = y;
		ev.clientX = x;
		ev.clientY = y;
		ev.pageX = x;
		ev.pageY = y;
		ev.screenX = x;
		ev.screenY = y;
		ev.primary = true;
		tree.dispatchEvent(ev);
	};

	switch (event_type) {
		case WEB_POINTER_DOWN:
			fire(PointerEventType::TouchStart);
			break;
		case WEB_POINTER_MOVE:
			fire(PointerEventType::TouchMove);
			break;
		case WEB_POINTER_UP:
			fire(PointerEventType::TouchEnd);
			break;
		case WEB_POINTER_CLICK:
			fire(PointerEventType::Click);
			break;
		default:
			break;
	}
}

// Second simultaneous finger (pointerId 2) for multi-touch gestures (pinch). The
// app tracks pointers by `event.pointerId` and computes pan (one) / pinch (two).
// Same Tree::dispatchEvent path as the primary, just a distinct pointer id — the
// device delivers the same via touch_runtime's dispatchSecondary.
EMSCRIPTEN_KEEPALIVE
void app_dispatch_pointer_event2(int event_type, int press_id, int x, int y)
{
	using gea::framework::events::PointerEvent;
	using gea::framework::events::PointerEventType;
	if (press_id < 0) return;
	auto &tree = gea::embedded::ui::Tree::instance();
	if (press_id >= tree.nodeCount()) return;

	// Web convention (matches touch_runtime.cpp dispatchSecondary): the first
	// extra finger is pointer id 2. Populate every coordinate field — the app
	// computes pinch distance from clientX/clientY of both fingers.
	auto fire = [&](PointerEventType type) {
		PointerEvent ev;
		ev.type = type;
		ev.targetId = press_id;
		ev.pointerId = 2;
		ev.x = x;
		ev.y = y;
		ev.clientX = x;
		ev.clientY = y;
		ev.pageX = x;
		ev.pageY = y;
		ev.screenX = x;
		ev.screenY = y;
		ev.primary = false;
		tree.dispatchEvent(ev);
	};

	switch (event_type) {
		case WEB_POINTER_DOWN:
			fire(PointerEventType::TouchStart);
			break;
		case WEB_POINTER_MOVE:
			fire(PointerEventType::TouchMove);
			break;
		case WEB_POINTER_UP:
			fire(PointerEventType::TouchEnd);
			break;
		default:
			break;
	}
}

EMSCRIPTEN_KEEPALIVE
const uint16_t *get_framebuffer_ptr(void)
{
	return web_display_pixels();
}

EMSCRIPTEN_KEEPALIVE
int get_framebuffer_width(void)
{
	return web_display_width();
}

EMSCRIPTEN_KEEPALIVE
int get_framebuffer_height(void)
{
	return web_display_height();
}

EMSCRIPTEN_KEEPALIVE
int get_framebuffer_stride_bytes(void)
{
	return web_display_stride_bytes();
}

}  // extern "C"
