#pragma once

#include "pixel.h"

#include <stdint.h>

#define FONT_W 8
#define FONT_H 16

void gea_embedded_display_clear(void);
void gea_embedded_display_clear_no_flush(void);
void gea_embedded_display_flush(void);

void gea_embedded_display_push_clip(int x, int y, int w, int h);
void gea_embedded_display_pop_clip(void);
void gea_embedded_display_reset_clip(void);

void gea_embedded_display_set_alpha(uint8_t a);
uint8_t gea_embedded_display_get_alpha(void);
int gea_embedded_display_get_brightness(void);
void gea_embedded_display_set_brightness(int brightness_percent);
void gea_embedded_display_get_clip(int *x0, int *y0, int *x1, int *y1);

void gea_embedded_display_fill_rect(int x, int y, int w, int h, uint16_t color);
void gea_embedded_display_scroll_rect(int x, int y, int w, int h, int dx, int dy);
void gea_embedded_display_stroke_rect(int x, int y, int w, int h, uint16_t color);
void gea_embedded_display_fill_circle(int cx, int cy, int r, uint16_t color);
void gea_embedded_display_stroke_circle(int cx, int cy, int r, uint16_t color);
void gea_embedded_display_draw_line(int x0, int y0, int x1, int y1, uint16_t color);
void gea_embedded_display_draw_arc(int cx, int cy, int r, int start_deg, int end_deg, uint16_t color);
void gea_embedded_display_fill_triangle(int x0, int y0, int x1, int y1, int x2, int y2, uint16_t color);
void gea_embedded_display_draw_text(const char *text, int x, int y, uint16_t color, float scale);
void gea_embedded_display_draw_text_font(const char *text, int x, int y, uint16_t color, int font_id);
void gea_embedded_display_draw_text_font_family(const char *text, int x, int y, uint16_t color, int family_id, int size_px);
void gea_embedded_display_set_pixel(int x, int y, uint16_t color);

void gea_embedded_display_fill_rounded_rect(int x, int y, int w, int h,
                                     int tl, int tr, int br, int bl,
                                     uint16_t color);
void gea_embedded_display_stroke_rounded_rect(int x, int y, int w, int h,
                                       int tl, int tr, int br, int bl,
                                       int lw, uint16_t color);

void gea_embedded_display_blit_image(const uint16_t *src, const uint8_t *alpha, int src_w, int src_h,
                              int dx, int dy);
void gea_embedded_display_blit_image_scaled(const uint16_t *src, const uint8_t *alpha, int src_w, int src_h,
                                     int dx, int dy, int dst_w, int dst_h);

// World-buffer overlay API (no-op stubs on the web target).
void gea_embedded_display_set_world_overlay(const uint16_t *world_pixels,
                                            int world_width, int world_height,
                                            int panel_top, int panel_height);
void gea_embedded_display_set_world_scroll(int scroll_x);
