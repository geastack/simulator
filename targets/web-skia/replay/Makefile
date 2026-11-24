SKIA_OUT ?= $(SKIA)/out/Replay
OUT ?= out
CXXFLAGS ?= -std=c++20 -O2 -DNDEBUG -Wall -Wextra
FRAMEWORKS = -framework CoreFoundation -framework CoreGraphics -framework CoreText -framework CoreServices

gskl2png: gskl2png.cpp gskl_replay.cpp gskl_replay.h
	$(if $(SKIA),,$(error set SKIA to a Skia checkout with a static build in out/Replay))
	$(CXX) $(CXXFLAGS) -I$(SKIA) gskl2png.cpp gskl_replay.cpp $(SKIA_OUT)/libskia.a $(FRAMEWORKS) -o $@

# The replayer against react-native-skia's bundled Skia headers (m154), compile only.
check-m154:
	$(if $(RNSKIA),,$(error set RNSKIA to react-native-skia 2.15.1's cpp/skia directory))
	$(CXX) $(CXXFLAGS) -fsyntax-only -I$(RNSKIA) gskl_replay.cpp

kit: gskl2png
	$(if $(KIT),,$(error set KIT to a test kit directory, see README.md))
	@status=0; for manifest in $(KIT)/*/manifest.json; do app=$$(dirname "$$manifest"); out=$$(./gskl2png "$$app" "$(OUT)/$$(basename "$$app")") || status=1; printf '%s\n' "$$out" | tail -n +2; done; exit $$status

clean:
	rm -f gskl2png

.PHONY: check-m154 kit clean
