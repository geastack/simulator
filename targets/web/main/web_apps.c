#include "apps.h"

#include <emscripten.h>

EM_JS(int, gea_embedded_web_launch_app, (const char *app_id), {
	const id = UTF8ToString(app_id || 0);
	if (!id) return 0;
	window.dispatchEvent(new CustomEvent('gea-embedded-launch-app', {
		detail: { appId: id }
	}));
	return 1;
});

int gea_embedded_apps_launch(const char *app_id)
{
	return gea_embedded_web_launch_app(app_id);
}

int gea_embedded_apps_return_to_launcher_on_reset(void)
{
	return 0;
}

void gea_embedded_apps_start_launcher_button_task(void)
{
}

const char *gea_embedded_apps_get_current_id(void)
{
	return "";
}
