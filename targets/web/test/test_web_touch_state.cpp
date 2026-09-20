#include "touch.h"

#include <cstdio>

int main()
{
	using gea::platform::touch::Phase;
	using gea::platform::touch::Touchscreen;

	int x = -1;
	int y = -1;
	if (Touchscreen::readCached(&x, &y) != 0 || x != 0 || y != 0) {
		std::fprintf(stderr, "expected initial web touch state to be idle at 0,0; got touching=%d x=%d y=%d\n",
		             Touchscreen::readCached(nullptr, nullptr),
		             x,
		             y);
		return 1;
	}

	Touchscreen::injectEvent(Phase::Down, true, 117, 457);
	x = 0;
	y = 0;
	if (Touchscreen::readCached(&x, &y) == 0 || x != 117 || y != 457) {
		std::fprintf(stderr, "expected down touch at 117,457; got touching=%d x=%d y=%d\n",
		             Touchscreen::readCached(nullptr, nullptr),
		             x,
		             y);
		return 1;
	}

	Touchscreen::injectEvent(Phase::Move, true, 318, 457);
	x = 0;
	y = 0;
	if (Touchscreen::readCached(&x, &y) == 0 || x != 318 || y != 457) {
		std::fprintf(stderr, "expected move touch at 318,457; got touching=%d x=%d y=%d\n",
		             Touchscreen::readCached(nullptr, nullptr),
		             x,
		             y);
		return 1;
	}

	Touchscreen::injectEvent(Phase::Up, false, 318, 457);
	x = 0;
	y = 0;
	if (Touchscreen::readCached(&x, &y) != 0 || x != 318 || y != 457) {
		std::fprintf(stderr, "expected released touch to preserve last coordinates 318,457; got touching=%d x=%d y=%d\n",
		             Touchscreen::readCached(nullptr, nullptr),
		             x,
		             y);
		return 1;
	}

	return 0;
}
