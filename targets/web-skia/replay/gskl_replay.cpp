#include "gskl_replay.h"

#include "include/core/SkBlurTypes.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkColor.h"
#include "include/core/SkColorSpace.h"
#include "include/core/SkData.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkImage.h"
#include "include/core/SkImageFilter.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkMaskFilter.h"
#include "include/core/SkMatrix.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPath.h"
#include "include/core/SkPathBuilder.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkRRect.h"
#include "include/core/SkSamplingOptions.h"
#include "include/core/SkShader.h"
#include "include/core/SkTextBlob.h"
#include "include/core/SkTypeface.h"
#include "include/core/SkVertices.h"
#include "include/effects/SkImageFilters.h"

#if __has_include("include/effects/SkGradient.h")
#include "include/effects/SkGradient.h"
#define GSKL_HAS_SK_GRADIENT 1
#else
#include "include/effects/SkGradientShader.h"
#define GSKL_HAS_SK_GRADIENT 0
#endif

#include <algorithm>
#include <cmath>
#include <cstring>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

constexpr uint32_t kMagic = 0x4C4B5347;
constexpr uint16_t kVersion = 1;
constexpr uint64_t kHeaderSize = 48;
constexpr uint64_t kFontEntrySize = 16;
constexpr uint32_t kOpHeaderSize = 8;
constexpr uint16_t kFlagUnchanged = 1;

enum Op : uint16_t {
    kSave = 1,
    kRestore = 2,
    kTranslate = 3,
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
    kShadow = 15,
    kLine = 16,
    kPath = 17,
    kSaveLayerBlur = 18,
};

// The payload bytes each known op reads at least, by opcode.
constexpr int kPayloadSize[] = {-1, 0, 0, 8, 16, 32, 36, 64, 28, 20, 40, 36, 8, 52, 52, 72, 28, 12,
                                24};
constexpr int kOpCount = sizeof(kPayloadSize) / sizeof(kPayloadSize[0]);

struct Header {
    uint16_t flags;
    uint32_t opsOffset, opsSize;
    uint32_t stringsOffset, stringsSize;
    uint32_t fontsOffset, fontsCount;
};

uint32_t readU32(const uint8_t* p) {
    uint32_t v;
    std::memcpy(&v, p, 4);
    return v;
}

uint16_t readU16(const uint8_t* p) {
    uint16_t v;
    std::memcpy(&v, p, 2);
    return v;
}

float readF32(const uint8_t* p) {
    float v;
    std::memcpy(&v, p, 4);
    return v;
}

SkColor4f toColor4f(uint32_t argb) {
    return SkColor4f::FromColor(static_cast<SkColor>(argb));
}

uint64_t hashBytes(uint32_t kind, const uint8_t* data, size_t size) {
    uint64_t hash = 0xcbf29ce484222325ull ^ kind;
    for (size_t i = 0; i < size; i++) {
        hash = (hash ^ data[i]) * 0x100000001b3ull;
    }
    return hash;
}

// The text with each ill-formed UTF-8 sequence replaced by U+FFFD, as a WHATWG TextDecoder does.
// Skia's text-to-glyph conversion assumes well-formed UTF-8.
std::string wellFormedUtf8(const uint8_t* s, size_t n) {
    std::string out;
    out.reserve(n);
    for (size_t i = 0; i < n;) {
        const uint8_t b = s[i];
        if (b < 0x80) {
            out.push_back(static_cast<char>(b));
            i++;
            continue;
        }
        int need;
        uint8_t lo = 0x80, hi = 0xBF;
        if (b >= 0xC2 && b <= 0xDF) {
            need = 1;
        } else if (b >= 0xE0 && b <= 0xEF) {
            need = 2;
            if (b == 0xE0) lo = 0xA0;
            if (b == 0xED) hi = 0x9F;
        } else if (b >= 0xF0 && b <= 0xF4) {
            need = 3;
            if (b == 0xF0) lo = 0x90;
            if (b == 0xF4) hi = 0x8F;
        } else {
            out += "\xEF\xBF\xBD";
            i++;
            continue;
        }
        size_t j = i + 1;
        bool ok = true;
        for (int k = 0; k < need; k++, j++) {
            if (j >= n || s[j] < lo || s[j] > hi) {
                ok = false;
                break;
            }
            lo = 0x80;
            hi = 0xBF;
        }
        if (ok) {
            out.append(reinterpret_cast<const char*>(s + i), j - i);
        } else {
            out += "\xEF\xBF\xBD";
        }
        i = j;
    }
    return out;
}

// Skia objects keyed by the list bytes that define them. sweep() drops the entries no replay
// found since the previous sweep, so after a replay the cache holds what that list drew.
template <typename T>
class ByteKeyedCache {
public:
    T* find(uint32_t kind, const uint8_t* key, size_t size) {
        auto it = fEntries.find(hashBytes(kind, key, size));
        if (it == fEntries.end()) return nullptr;
        Entry& entry = it->second;
        if (entry.kind != kind || entry.key.size() != size ||
            (size && std::memcmp(entry.key.data(), key, size) != 0)) {
            return nullptr;
        }
        entry.used = true;
        return &entry.object;
    }

    T* add(uint32_t kind, const uint8_t* key, size_t size, T object) {
        Entry& entry = fEntries[hashBytes(kind, key, size)];
        entry.kind = kind;
        entry.key.assign(key, key + size);
        entry.object = std::move(object);
        entry.used = true;
        return &entry.object;
    }

    void sweep() {
        for (auto it = fEntries.begin(); it != fEntries.end();) {
            if (it->second.used) {
                it->second.used = false;
                ++it;
            } else {
                it = fEntries.erase(it);
            }
        }
    }

    void clear() { fEntries.clear(); }

private:
    struct Entry {
        uint32_t kind = 0;
        std::vector<uint8_t> key;
        T object;
        bool used = false;
    };
    std::unordered_map<uint64_t, Entry> fEntries;
};

struct Face {
    uint32_t index;
    sk_sp<SkTypeface> typeface;
    SkFont font;
};

struct CachedImage {
    uint32_t generation;
    sk_sp<SkImage> image;
};

SkRRect makeRRect(float l, float t, float r, float b, const SkVector radii[4]) {
    SkVector clamped[4];
    for (int i = 0; i < 4; i++) {
        clamped[i] = {std::max(0.0f, radii[i].fX), std::max(0.0f, radii[i].fY)};
    }
    SkRRect rrect;
    rrect.setRectRadii(SkRect::MakeLTRB(l, t, r, b), clamped);
    return rrect;
}

}  // namespace

struct GsklReplayer::Impl {
    sk_sp<SkFontMgr> fontMgr;
    FontSource fonts;
    ImageSource images;

    std::unordered_map<std::string, std::unique_ptr<Face>> faces;
    std::vector<std::pair<uint32_t, Face*>> facesById;
    std::unordered_map<uint32_t, CachedImage> imageCache;
    ByteKeyedCache<sk_sp<SkShader>> shaders;
    ByteKeyedCache<sk_sp<SkMaskFilter>> blurs;
    ByteKeyedCache<sk_sp<SkImageFilter>> layerBlurs;
    ByteKeyedCache<SkPath> paths;
    ByteKeyedCache<sk_sp<SkTextBlob>> blobs;
    std::vector<uint8_t> scratch;

    const uint8_t* list = nullptr;
    size_t size = 0;
    Header header{};
    SkCanvas* canvas = nullptr;
    int depth = 0;
    std::string error;

    bool fail(std::string message) {
        error = "Malformed Gea Skia list: " + std::move(message);
        return false;
    }

    uint32_t u32(uint64_t at) const { return readU32(list + at); }
    float f32(uint64_t at) const { return readF32(list + at); }

    bool finite(uint64_t at, int count) const {
        for (int i = 0; i < count; i++) {
            if (!std::isfinite(f32(at + i * 4))) return false;
        }
        return true;
    }

    SkRect rect(uint64_t at) const {
        return SkRect::MakeLTRB(f32(at), f32(at + 4), f32(at + 8), f32(at + 12));
    }

    // A rect then four circular radii.
    SkRRect rrect(uint64_t at) const {
        SkVector radii[4];
        for (int i = 0; i < 4; i++) {
            float r = f32(at + 16 + i * 4);
            radii[i] = {r, r};
        }
        return makeRRect(f32(at), f32(at + 4), f32(at + 8), f32(at + 12), radii);
    }

    bool parseHeader() {
        if (size < kHeaderSize) return fail(std::to_string(size) + " bytes, shorter than the header");
        if (u32(0) != kMagic) return fail("bad magic");
        uint16_t version = readU16(list + 4);
        if (version != kVersion) {
            return fail("version " + std::to_string(version) + ", this host reads version 1");
        }
        header.flags = readU16(list + 6);
        header.opsOffset = u32(16);
        header.opsSize = u32(20);
        header.stringsOffset = u32(24);
        header.stringsSize = u32(28);
        header.fontsOffset = u32(32);
        header.fontsCount = u32(36);
        auto within = [&](const char* name, uint64_t offset, uint64_t bytes) {
            if (offset + bytes > size) {
                return fail(std::string(name) + " at " + std::to_string(offset) + ", " +
                            std::to_string(bytes) + " bytes, runs past the end of " +
                            std::to_string(size) + " bytes");
            }
            return true;
        };
        if (!within("ops", header.opsOffset, header.opsSize) ||
            !within("strings", header.stringsOffset, header.stringsSize) ||
            !within("font table", header.fontsOffset,
                    uint64_t(header.fontsCount) * kFontEntrySize)) {
            return false;
        }
        if (header.opsOffset % 4 || header.fontsOffset % 4) {
            return fail("ops or font table is not 4-byte aligned");
        }
        return true;
    }

    bool string(uint32_t offset, uint32_t length, const uint8_t** out) {
        if (uint64_t(offset) + length > header.stringsSize) {
            return fail("string at " + std::to_string(offset) + ", " + std::to_string(length) +
                        " bytes, runs past the string table");
        }
        *out = list + header.stringsOffset + offset;
        return true;
    }

    bool face(uint32_t fontId, Face** out) {
        for (auto& [id, known] : facesById) {
            if (id == fontId) {
                *out = known;
                return true;
            }
        }
        for (uint32_t i = 0; i < header.fontsCount; i++) {
            uint64_t entry = header.fontsOffset + uint64_t(i) * kFontEntrySize;
            if (u32(entry) != fontId) continue;
            const uint8_t* name;
            if (!string(u32(entry + 4), u32(entry + 8), &name)) return false;
            std::string fileName(reinterpret_cast<const char*>(name), u32(entry + 8));
            auto it = faces.find(fileName);
            if (it == faces.end()) {
                sk_sp<SkData> bytes = fonts ? fonts(fileName) : nullptr;
                if (!bytes) {
                    error = "The Gea bundle has no font file \"" + fileName + "\"";
                    return false;
                }
                sk_sp<SkTypeface> typeface =
                        fontMgr ? fontMgr->makeFromData(std::move(bytes)) : nullptr;
                if (!typeface) {
                    error = "The Gea bundle's \"" + fileName + "\" is not a font Skia reads";
                    return false;
                }
                auto made = std::make_unique<Face>();
                made->index = static_cast<uint32_t>(faces.size());
                made->typeface = typeface;
                made->font = SkFont(typeface, 1);
                // The engine laid the line out with unhinted advances; hinted ones run wider.
                // Unhinted outlines also render the same across FreeType versions.
                made->font.setSubpixel(true);
                made->font.setLinearMetrics(true);
                made->font.setHinting(SkFontHinting::kNone);
                it = faces.emplace(fileName, std::move(made)).first;
            }
            facesById.emplace_back(fontId, it->second.get());
            *out = it->second.get();
            return true;
        }
        return fail("font " + std::to_string(fontId) + " is not in the font table");
    }

    bool run() {
        uint64_t end = uint64_t(header.opsOffset) + header.opsSize;
        for (uint64_t at = header.opsOffset; at < end;) {
            if (end - at < kOpHeaderSize) return fail("op at " + std::to_string(at) + " is cut off");
            uint16_t opcode = readU16(list + at);
            uint32_t opSize = u32(at + 4);
            if (opSize < kOpHeaderSize || opSize % 4 || opSize > end - at) {
                return fail("op " + std::to_string(opcode) + " at " + std::to_string(at) +
                            " has size " + std::to_string(opSize));
            }
            if (opcode < kOpCount && kPayloadSize[opcode] >= 0 &&
                opSize < kOpHeaderSize + uint32_t(kPayloadSize[opcode])) {
                return fail("op " + std::to_string(opcode) + " at " + std::to_string(at) +
                            " has size " + std::to_string(opSize) + ", it needs " +
                            std::to_string(kOpHeaderSize + kPayloadSize[opcode]));
            }
            if (!op(opcode, at, opSize)) return false;
            at += opSize;
        }
        if (depth > 0) return fail(std::to_string(depth) + " Save with no Restore");
        return true;
    }

    bool op(uint16_t opcode, uint64_t at, uint32_t opSize) {
        const uint64_t p = at + kOpHeaderSize;
        switch (opcode) {
            case kSave:
                canvas->save();
                depth++;
                return true;
            case kRestore:
                if (depth == 0) return fail("Restore at " + std::to_string(at) + " has no Save");
                canvas->restore();
                depth--;
                return true;
            case kTranslate:
                canvas->translate(f32(p), f32(p + 4));
                return true;
            case kClipRect:
                canvas->clipRect(rect(p), SkClipOp::kIntersect, true);
                return true;
            case kClipRRect:
                canvas->clipRRect(rrect(p), SkClipOp::kIntersect, true);
                return true;
            case kFillRRect: {
                SkPaint paint = fillPaint(u32(p + 32));
                fillRRect(p, paint);
                return true;
            }
            case kBorder:
                border(p);
                return true;
            case kTextLine:
                return textLine(p);
            case kSaveLayerAlpha: {
                SkPaint paint;
                paint.setAlphaf(f32(p + 16));
                SkRect bounds = rect(p);
                canvas->saveLayer(&bounds, &paint);
                depth++;
                return true;
            }
            case kImage:
                image(p);
                return true;
            case kConcat: {
                if (!finite(p, 9)) {
                    return fail("Concat at " + std::to_string(at) + " has a non-finite matrix");
                }
                canvas->concat(SkMatrix::MakeAll(f32(p), f32(p + 4), f32(p + 8), f32(p + 12),
                                                 f32(p + 16), f32(p + 20), f32(p + 24),
                                                 f32(p + 28), f32(p + 32)));
                return true;
            }
            case kVertices:
                return vertices(at, opSize);
            case kLinearGradient:
            case kRadialGradient:
                return gradient(opcode, at, opSize);
            case kShadow:
                return shadow(at);
            case kLine:
                return line(at);
            case kPath:
                return path(at, opSize);
            case kSaveLayerBlur:
                return saveLayerBlur(at);
            default:
                return true;
        }
    }

    static SkPaint fillPaint(uint32_t argb) {
        SkPaint paint;
        paint.setAntiAlias(true);
        paint.setColor(static_cast<SkColor>(argb));
        return paint;
    }

    // A rect then four radii, filled as a rect when every radius is 0.
    void fillRRect(uint64_t p, const SkPaint& paint) {
        if (f32(p + 16) == 0 && f32(p + 20) == 0 && f32(p + 24) == 0 && f32(p + 28) == 0) {
            canvas->drawRect(rect(p), paint);
        } else {
            canvas->drawRRect(rrect(p), paint);
        }
    }

    void border(uint64_t p) {
        const float left = f32(p), top = f32(p + 4), right = f32(p + 8), bottom = f32(p + 12);
        const float rTL = f32(p + 16), rTR = f32(p + 20), rBR = f32(p + 24), rBL = f32(p + 28);
        const float wTop = f32(p + 32), wRight = f32(p + 36), wBottom = f32(p + 40),
                    wLeft = f32(p + 44);
        const uint32_t cTop = u32(p + 48), cRight = u32(p + 52), cBottom = u32(p + 56),
                       cLeft = u32(p + 60);

        if (wTop == wRight && wTop == wBottom && wTop == wLeft && cTop == cRight &&
            cTop == cBottom && cTop == cLeft) {
            if (!(wTop > 0) || (cTop >> 24) == 0) return;
            const float h = wTop / 2;
            SkPaint paint = fillPaint(cTop);
            paint.setStroke(true);
            paint.setStrokeWidth(wTop);
            const SkVector radii[4] = {
                    {rTL - h, rTL - h}, {rTR - h, rTR - h}, {rBR - h, rBR - h}, {rBL - h, rBL - h}};
            canvas->drawRRect(makeRRect(left + h, top + h, right - h, bottom - h, radii), paint);
            return;
        }

        // The ring between the outer rrect and the inner one CSS derives from it, split into a
        // top and a bottom band deep enough to hold the corners, and the left and right sides.
        canvas->save();
        canvas->clipRRect(rrect(p), SkClipOp::kIntersect, true);
        const float innerLeft = left + wLeft, innerTop = top + wTop;
        const float innerRight = right - wRight, innerBottom = bottom - wBottom;
        if (innerRight > innerLeft && innerBottom > innerTop) {
            const SkVector radii[4] = {{rTL - wLeft, rTL - wTop},
                                       {rTR - wRight, rTR - wTop},
                                       {rBR - wRight, rBR - wBottom},
                                       {rBL - wLeft, rBL - wBottom}};
            canvas->clipRRect(makeRRect(innerLeft, innerTop, innerRight, innerBottom, radii),
                              SkClipOp::kDifference, true);
        }
        float topBand = std::max({wTop, rTL, rTR});
        float bottomBand = std::max({wBottom, rBL, rBR});
        const float height = bottom - top;
        if (topBand + bottomBand > height) {
            const float scale = height / (topBand + bottomBand);
            topBand *= scale;
            bottomBand *= scale;
        }
        const float middleTop = top + topBand, middleBottom = bottom - bottomBand;
        side(wTop, cTop, left, top, right, middleTop);
        side(wBottom, cBottom, left, middleBottom, right, bottom);
        side(wLeft, cLeft, left, middleTop, innerLeft, middleBottom);
        side(wRight, cRight, innerRight, middleTop, right, middleBottom);
        canvas->restore();
    }

    void side(float width, uint32_t color, float l, float t, float r, float b) {
        if (!(width > 0) || (color >> 24) == 0 || r <= l || b <= t) return;
        canvas->drawRect(SkRect::MakeLTRB(l, t, r, b), fillPaint(color));
    }

    bool textLine(uint64_t p) {
        Face* found;
        if (!face(u32(p + 8), &found)) return false;
        const uint8_t* text;
        const uint32_t length = u32(p + 24);
        if (!string(u32(p + 20), length, &text)) return false;
        if (length == 0) return true;
        const float sizePx = f32(p + 12);

        scratch.resize(4 + length);
        std::memcpy(scratch.data(), &sizePx, 4);
        std::memcpy(scratch.data() + 4, text, length);
        sk_sp<SkTextBlob>* blob = blobs.find(found->index, scratch.data(), scratch.size());
        if (!blob) {
            found->font.setSize(sizePx);
            const std::string utf8 = wellFormedUtf8(text, length);
            blob = blobs.add(found->index, scratch.data(), scratch.size(),
                             SkTextBlob::MakeFromText(utf8.data(), utf8.size(), found->font,
                                                      SkTextEncoding::kUTF8));
        }
        if (*blob) canvas->drawTextBlob(*blob, f32(p), f32(p + 4), fillPaint(u32(p + 16)));
        return true;
    }

    void image(uint64_t p) {
        const uint32_t imageId = u32(p), generation = u32(p + 4);
        sk_sp<SkImage> drawn;
        auto it = imageCache.find(imageId);
        if (it != imageCache.end() && it->second.generation == generation) {
            drawn = it->second.image;
        } else {
            GsklImagePixels pixels;
            if (!images || !images(imageId, generation, &pixels) || !pixels.pixels ||
                pixels.width <= 0 || pixels.height <= 0) {
                return;
            }
            SkImageInfo info = SkImageInfo::Make(pixels.width, pixels.height,
                                                 kRGBA_8888_SkColorType, kUnpremul_SkAlphaType,
                                                 SkColorSpace::MakeSRGB());
            drawn = SkImages::RasterFromPixmapCopy(
                    SkPixmap(info, pixels.pixels, size_t(pixels.width) * 4));
            if (!drawn) return;
            imageCache[imageId] = {generation, drawn};
        }
        const SkRect src = rect(p + 8), dst = rect(p + 24);
        canvas->drawImageRect(drawn.get(), src, dst,
                              SkSamplingOptions(SkFilterMode::kLinear, SkMipmapMode::kNone),
                              nullptr, SkCanvas::kFast_SrcRectConstraint);
    }

    // Copies the record's positions and 0xAARRGGBB colors into an SkVertices. Blend mode Dst keeps
    // the vertex colors as they are; the paint's alpha and blend mode then apply to them.
    bool vertices(uint64_t at, uint32_t opSize) {
        const uint64_t p = at + kOpHeaderSize;
        const uint32_t count = u32(p);
        const uint32_t flags = u32(p + 4);
        const uint32_t blend = flags & 0xff;
        const uint32_t alpha = (flags >> 8) & 0xff;
        const std::string where = "Vertices at " + std::to_string(at);
        if (count % 3) return fail(where + " has " + std::to_string(count) + " vertices");
        if (blend > 1) return fail(where + " has blend " + std::to_string(blend));
        const uint64_t needs = kOpHeaderSize + 8 + uint64_t(count) * 12;
        if (opSize < needs) {
            return fail(where + " has size " + std::to_string(opSize) + ", it needs " +
                        std::to_string(needs));
        }
        if (count == 0 || alpha == 0) return true;
        SkVertices::Builder builder(SkVertices::kTriangles_VertexMode, static_cast<int>(count), 0,
                                    SkVertices::kHasColors_BuilderFlag);
        if (!builder.isValid()) return true;
        std::memcpy(builder.positions(), list + p + 8, size_t(count) * 8);
        std::memcpy(builder.colors(), list + p + 8 + uint64_t(count) * 8, size_t(count) * 4);
        SkPaint paint;
        paint.setAlphaf(alpha / 255.0f);
        paint.setBlendMode(blend == 1 ? SkBlendMode::kPlus : SkBlendMode::kSrcOver);
        canvas->drawVertices(builder.detach(), SkBlendMode::kDst, paint);
        return true;
    }

    // Fills the record's rrect with the gradient its other bytes define, looked up by those bytes.
    bool gradient(uint16_t opcode, uint64_t at, uint32_t opSize) {
        const char* name = opcode == kLinearGradient ? "LinearGradient" : "RadialGradient";
        const uint64_t p = at + kOpHeaderSize;
        const uint32_t count = u32(p + 48);
        const std::string where = std::string(name) + " at " + std::to_string(at);
        if (count < 2) return fail(where + " has " + std::to_string(count) + " stops");
        const uint64_t needs = kOpHeaderSize + 52 + uint64_t(count) * 8;
        if (opSize != needs) {
            return fail(where + " has size " + std::to_string(opSize) + ", " +
                        std::to_string(count) + " stops need " + std::to_string(needs));
        }
        if (!finite(p, 8)) return fail(where + " has a non-finite number");
        const uint64_t key = p + 32;
        const size_t keySize = at + opSize - key;
        sk_sp<SkShader>* shader = shaders.find(opcode, list + key, keySize);
        if (!shader) {
            sk_sp<SkShader> made;
            if (!makeGradient(opcode, key, count, where, &made)) return false;
            shader = shaders.add(opcode, list + key, keySize, std::move(made));
        }
        SkPaint paint;
        paint.setAntiAlias(true);
        paint.setShader(*shader);
        fillRRect(p, paint);
        return true;
    }

    bool makeGradient(uint16_t opcode, uint64_t key, uint32_t count, const std::string& where,
                      sk_sp<SkShader>* out) {
        if (!finite(key, 4)) return fail(where + " has a non-finite number");
        std::vector<SkColor4f> colors(count);
        std::vector<float> positions(count);
        for (uint32_t i = 0; i < count; i++) {
            const uint64_t stop = key + 20 + uint64_t(i) * 8;
            positions[i] = f32(stop);
            if (!std::isfinite(positions[i])) return fail(where + " has a non-finite number");
            colors[i] = toColor4f(u32(stop + 4));
        }
        const SkPoint start = {f32(key), f32(key + 4)};
        const SkMatrix* localMatrix = nullptr;
        SkMatrix matrix;
        float radius = 0;
        if (opcode == kRadialGradient) {
            const float rx = f32(key + 8), ry = f32(key + 12);
            if (rx < 0 || ry < 0) return fail(where + " has negative radii");
            if (rx != 0 && ry != 0) {
                const float scale = ry / rx;
                matrix = SkMatrix::MakeAll(1, 0, 0, 0, scale, start.fY * (1 - scale), 0, 0, 1);
                localMatrix = &matrix;
                radius = rx;
            }
        }
#if GSKL_HAS_SK_GRADIENT
        const SkGradient gradient(
                SkGradient::Colors(SkSpan<const SkColor4f>(colors.data(), colors.size()),
                                   SkSpan<const float>(positions.data(), positions.size()),
                                   SkTileMode::kClamp),
                SkGradient::Interpolation{});
        if (opcode == kLinearGradient) {
            const SkPoint pts[2] = {start, {f32(key + 8), f32(key + 12)}};
            *out = SkShaders::LinearGradient(pts, gradient, nullptr);
        } else {
            *out = SkShaders::RadialGradient(start, radius, gradient, localMatrix);
        }
#else
        if (opcode == kLinearGradient) {
            const SkPoint pts[2] = {start, {f32(key + 8), f32(key + 12)}};
            *out = SkGradientShader::MakeLinear(pts, colors.data(), nullptr, positions.data(),
                                                static_cast<int>(count), SkTileMode::kClamp, 0,
                                                nullptr);
        } else {
            *out = SkGradientShader::MakeRadial(start, radius, colors.data(), nullptr,
                                                positions.data(), static_cast<int>(count),
                                                SkTileMode::kClamp, 0, localMatrix);
        }
#endif
        return true;
    }

    // Fills the shadow rrect through a blur of its sigma, outside the casting box.
    bool shadow(uint64_t at) {
        const uint64_t p = at + kOpHeaderSize;
        if (!finite(p, 9) || !finite(p + 40, 8)) {
            return fail("Shadow at " + std::to_string(at) + " has a non-finite number");
        }
        const float sigma = f32(p + 32);
        if (sigma < 0) return fail("Shadow at " + std::to_string(at) + " has negative sigma");
        const uint32_t color = u32(p + 36);
        if ((color >> 24) == 0) return true;
        SkPaint paint = fillPaint(color);
        if (sigma > 0) {
            sk_sp<SkMaskFilter>* blur = blurs.find(0, list + p + 32, 4);
            if (!blur) {
                blur = blurs.add(0, list + p + 32, 4,
                                 SkMaskFilter::MakeBlur(kNormal_SkBlurStyle, sigma, true));
            }
            paint.setMaskFilter(*blur);
        }
        canvas->save();
        canvas->clipRRect(rrect(p + 40), SkClipOp::kDifference, true);
        fillRRect(p, paint);
        canvas->restore();
        return true;
    }

    bool line(uint64_t at) {
        const uint64_t p = at + kOpHeaderSize;
        if (!finite(p, 5)) return fail("Line at " + std::to_string(at) + " has a non-finite number");
        const float width = f32(p + 16);
        const uint32_t color = u32(p + 20), cap = u32(p + 24);
        if (width < 0) return fail("Line at " + std::to_string(at) + " has negative width");
        if (cap > 2) return fail("Line at " + std::to_string(at) + " has cap " + std::to_string(cap));
        if (width == 0 || (color >> 24) == 0) return true;
        static constexpr SkPaint::Cap kCaps[] = {SkPaint::kButt_Cap, SkPaint::kRound_Cap,
                                                 SkPaint::kSquare_Cap};
        SkPaint paint = fillPaint(color);
        paint.setStroke(true);
        paint.setStrokeWidth(width);
        paint.setStrokeCap(kCaps[cap]);
        canvas->drawLine(f32(p), f32(p + 4), f32(p + 8), f32(p + 12), paint);
        return true;
    }

    // Fills the record's contours. The path is looked up by its fill rule and the bytes after its
    // colour, so a path a previous replay drew is neither validated nor built again.
    bool path(uint64_t at, uint32_t opSize) {
        const uint64_t p = at + kOpHeaderSize;
        const uint64_t end = at + opSize;
        const uint32_t rule = u32(p);
        const uint32_t color = u32(p + 4);
        const uint8_t* key = list + p + 8;
        const size_t keySize = end - (p + 8);
        SkPath* found = paths.find(rule, key, keySize);
        if (!found) {
            const std::string where = "Path at " + std::to_string(at);
            if (rule > 1) return fail(where + " has fill rule " + std::to_string(rule));
            const uint32_t contours = u32(p + 8);
            uint64_t q = p + 12;
            for (uint32_t i = 0; i < contours; i++) {
                if (q + 4 > end || u32(q) > (end - q - 4) / 8) {
                    return fail(where + " has size " + std::to_string(opSize) +
                                ", its contours run past it");
                }
                q += 4 + uint64_t(u32(q)) * 8;
            }
            if (q != end) {
                return fail(where + " has size " + std::to_string(opSize) +
                            ", its contours need " + std::to_string(q - at));
            }
            if (!finite(p + 12, static_cast<int>((end - p - 12) / 4))) {
                return fail(where + " has a non-finite number");
            }
            SkPathBuilder builder(rule == 1 ? SkPathFillType::kEvenOdd : SkPathFillType::kWinding);
            for (q = p + 12; q < end;) {
                const uint32_t points = u32(q);
                const uint64_t start = q + 4;
                q = start + uint64_t(points) * 8;
                if (points < 2) continue;
                builder.moveTo(f32(start), f32(start + 4));
                for (uint64_t i = start + 8; i < q; i += 8) builder.lineTo(f32(i), f32(i + 4));
                builder.close();
            }
            found = paths.add(rule, key, keySize, builder.detach());
        }
        if ((color >> 24) == 0 || found->isEmpty()) return true;
        canvas->drawPath(*found, fillPaint(color));
        return true;
    }

    // A layer blurred by its sigmas when restored; a plain layer when both are 0.
    bool saveLayerBlur(uint64_t at) {
        const uint64_t p = at + kOpHeaderSize;
        const float sigmaX = f32(p + 16), sigmaY = f32(p + 20);
        if (!(sigmaX >= 0 && sigmaY >= 0 && std::isfinite(sigmaX) && std::isfinite(sigmaY))) {
            return fail("SaveLayerBlur at " + std::to_string(at) + " has bad sigmas");
        }
        const SkRect bounds = rect(p);
        depth++;
        if (sigmaX == 0 && sigmaY == 0) {
            canvas->saveLayer(&bounds, nullptr);
            return true;
        }
        sk_sp<SkImageFilter>* filter = layerBlurs.find(0, list + p + 16, 8);
        if (!filter) {
            filter = layerBlurs.add(0, list + p + 16, 8,
                                    SkImageFilters::Blur(sigmaX, sigmaY, SkTileMode::kDecal,
                                                         nullptr));
        }
        SkPaint paint;
        paint.setImageFilter(*filter);
        canvas->saveLayer(&bounds, &paint);
        return true;
    }
};

GsklReplayer::GsklReplayer(sk_sp<SkFontMgr> fontMgr, FontSource fonts, ImageSource images)
        : fImpl(std::make_unique<Impl>()) {
    fImpl->fontMgr = std::move(fontMgr);
    fImpl->fonts = std::move(fonts);
    fImpl->images = std::move(images);
}

GsklReplayer::~GsklReplayer() = default;

bool GsklReplayer::replay(const uint8_t* list, size_t size, SkCanvas* canvas, std::string* error) {
    Impl& impl = *fImpl;
    impl.list = list;
    impl.size = list ? size : 0;
    impl.canvas = canvas;
    impl.depth = 0;
    impl.error.clear();
    impl.facesById.clear();
    const int saveCount = canvas->getSaveCount();
    const bool ok = impl.parseHeader() && impl.run();
    canvas->restoreToCount(saveCount);
    impl.shaders.sweep();
    impl.blurs.sweep();
    impl.layerBlurs.sweep();
    impl.paths.sweep();
    impl.blobs.sweep();
    impl.list = nullptr;
    impl.canvas = nullptr;
    if (!ok && error) *error = impl.error;
    return ok;
}

bool GsklReplayer::IsUnchanged(const uint8_t* list, size_t size) {
    return list && size >= kHeaderSize && readU32(list) == kMagic &&
           (readU16(list + 6) & kFlagUnchanged) != 0;
}

void GsklReplayer::clear() {
    Impl& impl = *fImpl;
    impl.faces.clear();
    impl.facesById.clear();
    impl.imageCache.clear();
    impl.shaders.clear();
    impl.blurs.clear();
    impl.layerBlurs.clear();
    impl.paths.clear();
    impl.blobs.clear();
}
