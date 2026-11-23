// gskl2png <app dir> <out dir> [--threshold N]
//
// Replays every frame of an app's manifest.json onto a raster surface with one GsklReplayer, writes
// <out dir>/frame-NNN.png (and frame-NNN.diff.png where pixels differ), and prints per frame the
// share of pixels whose premultiplied channels differ from the expected PNG by more than N
// (default 8 of 255).

#include "gskl_replay.h"

#include "include/codec/SkCodec.h"
#include "include/codec/SkPngDecoder.h"
#include "include/core/SkBitmap.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkStream.h"
#include "include/core/SkSurface.h"
#include "include/encode/SkPngEncoder.h"
#include "include/ports/SkFontMgr_empty.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <map>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace {

// Just enough JSON for manifest.json.
struct Json {
    enum Kind { kNull, kBool, kNumber, kString, kArray, kObject } kind = kNull;
    double number = 0;
    std::string text;
    std::vector<Json> items;
    std::map<std::string, Json> fields;

    const Json& operator[](const std::string& key) const {
        static const Json missing;
        auto it = fields.find(key);
        return it == fields.end() ? missing : it->second;
    }
};

class JsonParser {
public:
    explicit JsonParser(const std::string& s) : fS(s) {}

    bool parse(Json* out) {
        if (!value(out)) return false;
        skip();
        return fAt == fS.size();
    }

private:
    const std::string& fS;
    size_t fAt = 0;

    void skip() {
        while (fAt < fS.size() && std::isspace(static_cast<unsigned char>(fS[fAt]))) fAt++;
    }

    bool literal(const char* word) {
        size_t n = std::strlen(word);
        if (fS.compare(fAt, n, word) != 0) return false;
        fAt += n;
        return true;
    }

    bool string(std::string* out) {
        if (fS[fAt] != '"') return false;
        fAt++;
        while (fAt < fS.size() && fS[fAt] != '"') {
            char c = fS[fAt++];
            if (c == '\\' && fAt < fS.size()) {
                char e = fS[fAt++];
                switch (e) {
                    case 'n': c = '\n'; break;
                    case 't': c = '\t'; break;
                    case 'r': c = '\r'; break;
                    case 'b': c = '\b'; break;
                    case 'f': c = '\f'; break;
                    case 'u':
                        fAt += 4;
                        c = '?';
                        break;
                    default: c = e;
                }
            }
            out->push_back(c);
        }
        if (fAt >= fS.size()) return false;
        fAt++;
        return true;
    }

    bool value(Json* out) {
        skip();
        if (fAt >= fS.size()) return false;
        char c = fS[fAt];
        if (c == '{') {
            out->kind = Json::kObject;
            fAt++;
            skip();
            if (fS[fAt] == '}') return ++fAt, true;
            for (;;) {
                skip();
                std::string key;
                if (!string(&key)) return false;
                skip();
                if (fS[fAt++] != ':') return false;
                if (!value(&out->fields[key])) return false;
                skip();
                if (fS[fAt] == ',') { fAt++; continue; }
                if (fS[fAt] == '}') return ++fAt, true;
                return false;
            }
        }
        if (c == '[') {
            out->kind = Json::kArray;
            fAt++;
            skip();
            if (fS[fAt] == ']') return ++fAt, true;
            for (;;) {
                out->items.emplace_back();
                if (!value(&out->items.back())) return false;
                skip();
                if (fS[fAt] == ',') { fAt++; continue; }
                if (fS[fAt] == ']') return ++fAt, true;
                return false;
            }
        }
        if (c == '"') {
            out->kind = Json::kString;
            return string(&out->text);
        }
        if (literal("true")) { out->kind = Json::kBool; out->number = 1; return true; }
        if (literal("false")) { out->kind = Json::kBool; return true; }
        if (literal("null")) return true;
        char* end;
        out->number = std::strtod(fS.c_str() + fAt, &end);
        if (end == fS.c_str() + fAt) return false;
        out->kind = Json::kNumber;
        fAt = end - fS.c_str();
        return true;
    }
};

bool decodePng(const fs::path& file, SkBitmap* out) {
    sk_sp<SkData> data = SkData::MakeFromFileName(file.c_str());
    if (!data) return false;
    std::unique_ptr<SkCodec> codec = SkPngDecoder::Decode(data, nullptr);
    if (!codec) return false;
    SkImageInfo info = codec->getInfo().makeColorType(kRGBA_8888_SkColorType)
                               .makeAlphaType(kPremul_SkAlphaType);
    if (!out->tryAllocPixels(info)) return false;
    return codec->getPixels(out->pixmap()) == SkCodec::kSuccess;
}

bool encodePng(const fs::path& file, const SkPixmap& pixmap) {
    SkFILEWStream stream(file.c_str());
    return stream.isValid() && SkPngEncoder::Encode(&stream, pixmap, {});
}

int fail(const std::string& message) {
    std::fprintf(stderr, "gskl2png: %s\n", message.c_str());
    return 1;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "usage: gskl2png <app dir> <out dir> [--threshold N]\n");
        return 2;
    }
    const fs::path appDir = argv[1];
    const fs::path outDir = argv[2];
    int threshold = 8;
    for (int i = 3; i + 1 < argc; i++) {
        if (std::string(argv[i]) == "--threshold") threshold = std::atoi(argv[++i]);
    }

    sk_sp<SkData> manifestData = SkData::MakeFromFileName((appDir / "manifest.json").c_str());
    if (!manifestData) return fail("cannot read " + (appDir / "manifest.json").string());
    const std::string manifestText(static_cast<const char*>(manifestData->data()),
                                   manifestData->size());
    Json manifest;
    if (!JsonParser(manifestText).parse(&manifest)) return fail("manifest.json is not valid JSON");
    fs::create_directories(outDir);

    const std::string app = manifest["app"].text.empty() ? appDir.filename().string()
                                                         : manifest["app"].text;

    // Pixels of the frame being replayed, by (id, generation), loaded on demand.
    const Json* frameImages = nullptr;
    std::map<std::pair<uint32_t, uint32_t>, sk_sp<SkData>> loaded;

    GsklReplayer replayer(
            SkFontMgr_New_Custom_Empty(),
            [&](const std::string& name) {
                return SkData::MakeFromFileName((appDir / "fonts" / name).c_str());
            },
            [&](uint32_t id, uint32_t generation, GsklImagePixels* out) {
                if (!frameImages) return false;
                for (const Json& image : frameImages->items) {
                    if (uint32_t(image["id"].number) != id ||
                        uint32_t(image["generation"].number) != generation) {
                        continue;
                    }
                    sk_sp<SkData>& data = loaded[{id, generation}];
                    if (!data) {
                        data = SkData::MakeFromFileName((appDir / image["file"].text).c_str());
                    }
                    const int width = int(image["width"].number);
                    const int height = int(image["height"].number);
                    if (!data || data->size() < size_t(width) * height * 4) return false;
                    out->width = width;
                    out->height = height;
                    out->pixels = data->bytes();
                    return true;
                }
                return false;
            });

    int failures = 0;
    std::printf("%-24s %-16s %10s %8s %10s\n", "app", "frame", "diff%", "maxDiff", "replayMs");
    for (const Json& frame : manifest["frames"].items) {
        const std::string listName = frame["list"].text;
        const std::string stem = fs::path(listName).stem().string();
        frameImages = &frame["images"];

        sk_sp<SkData> list = SkData::MakeFromFileName((appDir / listName).c_str());
        if (!list) {
            std::printf("%-24s %-16s cannot read %s\n", app.c_str(), stem.c_str(), listName.c_str());
            failures++;
            continue;
        }

        SkBitmap expected;
        const std::string expectedName = frame["expected"].text;
        const bool haveExpected = !expectedName.empty();
        if (haveExpected && !decodePng(appDir / expectedName, &expected)) {
            std::printf("%-24s %-16s cannot read %s\n", app.c_str(), stem.c_str(),
                        expectedName.c_str());
            failures++;
            continue;
        }
        int width = haveExpected ? expected.width()
                                 : int(manifest["viewport"]["width"].number *
                                       (manifest["dpr"].number > 0 ? manifest["dpr"].number : 1));
        int height = haveExpected ? expected.height()
                                  : int(manifest["viewport"]["height"].number *
                                        (manifest["dpr"].number > 0 ? manifest["dpr"].number : 1));

        SkImageInfo info = SkImageInfo::Make(width, height, kRGBA_8888_SkColorType,
                                             kPremul_SkAlphaType);
        sk_sp<SkSurface> surface = SkSurfaces::Raster(info);
        if (!surface) return fail("cannot make a " + std::to_string(width) + "x" +
                                  std::to_string(height) + " surface");
        SkCanvas* canvas = surface->getCanvas();
        canvas->clear(SK_ColorTRANSPARENT);

        std::string error;
        const auto started = std::chrono::steady_clock::now();
        const bool ok = replayer.replay(list->bytes(), list->size(), canvas, &error);
        const double ms = std::chrono::duration<double, std::milli>(
                                  std::chrono::steady_clock::now() - started)
                                  .count();
        if (!ok) {
            std::printf("%-24s %-16s replay failed: %s\n", app.c_str(), stem.c_str(),
                        error.c_str());
            failures++;
        }

        SkBitmap actual;
        actual.allocPixels(info);
        surface->readPixels(actual.pixmap(), 0, 0);
        encodePng(outDir / (stem + ".png"), actual.pixmap());

        if (!haveExpected) {
            std::printf("%-24s %-16s %10s %8s %10.3f\n", app.c_str(), stem.c_str(), "-", "-", ms);
            continue;
        }

        SkBitmap diff;
        diff.allocPixels(info);
        diff.eraseColor(SK_ColorTRANSPARENT);
        long differing = 0;
        int maxDiff = 0;
        for (int y = 0; y < height; y++) {
            const uint8_t* a = static_cast<const uint8_t*>(actual.getAddr(0, y));
            const uint8_t* e = static_cast<const uint8_t*>(expected.getAddr(0, y));
            uint8_t* d = static_cast<uint8_t*>(diff.getAddr(0, y));
            for (int x = 0; x < width; x++) {
                int worst = 0;
                for (int c = 0; c < 4; c++) worst = std::max(worst, std::abs(a[x * 4 + c] - e[x * 4 + c]));
                maxDiff = std::max(maxDiff, worst);
                if (worst > threshold) {
                    differing++;
                    d[x * 4] = 255;
                    d[x * 4 + 3] = 255;
                } else {
                    d[x * 4 + 3] = std::max(a[x * 4 + 3], e[x * 4 + 3]) / 6;
                }
            }
        }
        const double pct = 100.0 * double(differing) / (double(width) * height);
        if (differing) encodePng(outDir / (stem + ".diff.png"), diff.pixmap());
        std::printf("%-24s %-16s %10.4f %8d %10.3f\n", app.c_str(), stem.c_str(), pct, maxDiff, ms);
    }
    return failures ? 1 : 0;
}
