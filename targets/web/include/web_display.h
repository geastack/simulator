#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

int web_display_resize(int width, int height);
const uint16_t *web_display_pixels(void);
int web_display_width(void);
int web_display_height(void);
int web_display_stride_bytes(void);

#ifdef __cplusplus
}
#endif
