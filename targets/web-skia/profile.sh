# Target profile sourced by targets/web/build-web.sh (GEA_WEB_TARGET_PROFILE):
# the web pipeline, presenting a Skia display list instead of a framebuffer.
# Colours are kept at full RGBA8888 precision (GEA_EMBEDDED_PIXEL_FORMAT=1),
# and text is measured at runtime from the app's @font-face TTFs, the same files
# Skia draws with, instead of from atlases baked at fixed sizes.
WEB_TARGET_SOURCES=(
  "$ROOT_DIR/targets/web/main/web_main.cpp"
  "$ROOT_DIR/targets/web-skia/main/skia_display.cpp"
  "$ROOT_DIR/targets/web-skia/main/skia_main.cpp"
)
WEB_TARGET_EXPORTED_FUNCTIONS='["_app_init","_app_frame","_app_dispatch_key_down","_app_dispatch_pointer_event","_app_dispatch_pointer_event2","_app_hit_test","_app_touch_down","_app_touch_up","_app_touch_move","_app_pointer_hover","_get_skia_list_ptr","_get_skia_list_size","_skia_image_pixels","_skia_image_width","_skia_image_height","_skia_census_enable","_get_skia_census","_gea_web_media_inject_pcm","_malloc","_free"]'
WEB_TARGET_DEFINES=(-DGEA_EMBEDDED_PIXEL_FORMAT=1 -DGEA_EMBEDDED_TTF_RUNTIME_FONTS=1 -DGEA_EMBEDDED_DEFAULT_FONT_FAMILY_ID=0)
# Text with no font-family is set in Inter, shipped and measured like any other
# family; the generator makes it family 0.
WEB_TARGET_GENERATOR_ARGS=(--runtime-ttf-fonts --default-font-face "Inter=${GEA_SKIA_DEFAULT_FONT:?set by build-skia.mjs}")
