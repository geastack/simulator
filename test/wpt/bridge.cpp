// SPDX-License-Identifier: Apache-2.0
// Test-only document loader. Layout, CSS resolution and painting stay in Gea.
#include <emscripten/emscripten.h>
#include "ui/document.h"
#include "ui/tree_internal.h"
#include "ui/internal.h"
#include "ui/style.h"
#include "pixel.h"
#include "display.h"
#include "canvas.h"
#include "web_display.h"
#include "graphics/font.h"
#include <string>
#include <vector>
#include <algorithm>
#include <cctype>

namespace {
struct TestFont { std::string family; std::vector<std::uint8_t> bytes; };
std::vector<TestFont> testFonts;
std::string fontKey(const char *name) {
  std::string key(name ? name : "");
  std::transform(key.begin(), key.end(), key.begin(), [](unsigned char c) { return std::tolower(c); });
  return key;
}
}
namespace gea::framework::graphics::generated {
void ensureLinked() {}
int lookupFontFamily(const char *family) {
  const auto key = fontKey(family);
  for (std::size_t i = 0; i < testFonts.size(); ++i) if (testFonts[i].family == key) return static_cast<int>(i);
  return -1;
}
const char *lookupFontFamilyName(int id) {
  return id >= 0 && static_cast<std::size_t>(id) < testFonts.size() ? testFonts[id].family.c_str() : nullptr;
}
const std::uint8_t *lookupRuntimeTtfFontForFamily(int id, unsigned long *length) {
  if (length) *length = 0;
  if (id < 0 || static_cast<std::size_t>(id) >= testFonts.size()) return nullptr;
  const auto &bytes = testFonts[id].bytes;
  if (length) *length = bytes.size();
  return bytes.data();
}
}
namespace gea::framework::app::generated { void drainMicrotasks() {} }
using namespace gea::embedded::ui;

extern "C" {
EMSCRIPTEN_KEEPALIVE int wpt_init(int width, int height) {
  if (width < 1 || height < 1 || !web_display_resize(width, height)) return 0;
  setViewportMetrics(width, height, 1.0);
  // HTML defaults stay in the loader; the shared cascade resolves their em
  // lengths and keeps them below every author rule, including '* {margin:0}'.
  auto &sheet = StyleSheet::instance();
  sheet.registerUserAgentElementRule("p", "display", "block");
  sheet.registerUserAgentElementRule("p", "margin-top", "1em");
  sheet.registerUserAgentElementRule("p", "margin-bottom", "1em");
  sheet.registerUserAgentElementRule("strong", "font-weight", "bold");
  // Elements HTML does not define are HTMLUnknownElement: inline unless styled.
  for (const char *tag : {"flexbox", "grid", "container", "item"}) sheet.registerUserAgentElementRule(tag, "display", "inline");
  return 1;
}
EMSCRIPTEN_KEEPALIVE int wpt_font(const char *family, const std::uint8_t *bytes, int length) {
  using namespace gea::framework::graphics;
  if (!family || !*family || !bytes || length < 12 || generated::lookupFontFamily(family) >= 0) return -1;
  // Copy into stable storage for the lifetime of this document/WASM instance.
  // The engine's existing TTF rasterizer owns all metrics and glyph coverage.
  const int id = static_cast<int>(testFonts.size());
  testFonts.push_back({fontKey(family), {bytes, bytes + length}});
  if (!FontRegistry::rasterizedFamily(id, 20).valid()) return -1;
  return id;
}
EMSCRIPTEN_KEEPALIVE int wpt_text(const char *text, int parent) {
  auto node = Document::instance().createText(text);
  if (node.id() < 0) return -1;
  Tree::instance().setTagName(node.id(), "#text");
  if (parent >= 0) NodeHandle(parent).appendChild(node);
  return node.id();
}
EMSCRIPTEN_KEEPALIVE int wpt_element(const char *tag, int parent) {
  auto node = Document::instance().createElement(tag);
  if (node.id() < 0) return -1;
  if (parent >= 0) NodeHandle(parent).appendChild(node);
  // HTML UA defaults at Gea's default-style priority, below author rules.
  auto &tree = Tree::instance();
  if (std::string(tag) == "body") {
    for (auto p : {Property::MarginTop, Property::MarginRight, Property::MarginBottom, Property::MarginLeft})
      tree.setDefaultStyle(node.id(), p, 8);
  }
  if (std::string(tag) == "html") {
    tree.setDefaultStyle(node.id(), Property::Color, gea::framework::graphics::pixel::nativeColor(0, 0, 0));
    tree.setDefaultStyle(node.id(), Property::FontSize, 16);
    const int serif = gea::framework::graphics::FontRegistry::familyId("serif");
    if (serif >= 0) tree.setDefaultStyle(node.id(), Property::FontId, serif);
  }
  return node.id();
}
EMSCRIPTEN_KEEPALIVE void wpt_attribute(int node, const char *name, const char *value) {
  NodeHandle(node).setAttribute(name, value);
}
EMSCRIPTEN_KEEPALIVE void wpt_rule(const char *selector, const char *property, const char *value) {
  const std::string text(selector);
  const auto simpleName = [](const std::string &s) {
    return !s.empty() && std::all_of(s.begin(), s.end(), [](unsigned char c) { return std::isalnum(c) || c == '-' || c == '_'; });
  };
  // Use the public API's selector categories. Generic selectors intentionally
  // alias html/body to a native application's root; element rules match real
  // tags, which is what an imported HTML document needs.
  if (simpleName(text)) StyleSheet::instance().registerElementRule(text, property, value);
  else if (text.size() > 1 && text[0] == '.' && simpleName(text.substr(1))) StyleSheet::instance().registerRule(text.substr(1), property, value);
  else StyleSheet::instance().registerSelectorRule(text, property, value);
}
EMSCRIPTEN_KEEPALIVE void wpt_inline(int node, const char *property, const char *value) {
  NodeHandle(node).style().setProperty(property, value);
}
EMSCRIPTEN_KEEPALIVE void wpt_render(int root, int width, int height) {
  Tree::instance().mount(root, width, height);
  // The HTML viewport has a white canvas even when its root is zero-height
  // (e.g. an entirely absolutely positioned document). Reuse the engine's
  // recorded paint commands on that surface, without altering any node boxes.
  gea::platform::display::Display::canvas()->clear(0xffff);
  DisplayList::instance().replay();
}
EMSCRIPTEN_KEEPALIVE const uint16_t *wpt_pixels() { return web_display_pixels(); }
EMSCRIPTEN_KEEPALIVE int wpt_hover(int root, int width, int height, int x, int y) {
  auto &tree = Tree::instance();
  const int target = tree.pointerHover(x, y);
  tree.refresh(root, width, height);
  gea::platform::display::Display::canvas()->clear(0xffff);
  DisplayList::instance().replay();
  return target;
}
EMSCRIPTEN_KEEPALIVE int wpt_geometry(int id, int field) {
  const auto &n = Tree::instance().node(id);
  switch (field) {
    case 0: return n.layout.x;
    case 1: return n.layout.y;
    case 2: return n.layout.width;
    case 3: return n.layout.height;
    default: return -1;
  }
}
}
