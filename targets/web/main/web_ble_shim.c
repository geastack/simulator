#include "ble.h"

#include <string.h>

static char s_device_name[64] = "Gea Embedded BLE";
static char s_mac_address[18] = "02:00:00:00:00:02";
static uint8_t s_battery_level = 82;
static int s_enabled = 1;

void gea_embedded_ble_preinit(void) {}

void gea_embedded_ble_init(const char *device_name, uint16_t appearance, const char *mac_address) {
	(void)appearance;
	if (device_name && device_name[0]) {
		strncpy(s_device_name, device_name, sizeof(s_device_name) - 1);
		s_device_name[sizeof(s_device_name) - 1] = '\0';
	}
	if (mac_address && mac_address[0]) {
		strncpy(s_mac_address, mac_address, sizeof(s_mac_address) - 1);
		s_mac_address[sizeof(s_mac_address) - 1] = '\0';
	}
}

void gea_embedded_ble_start_advertising(void) {}
void gea_embedded_ble_stop_advertising(void) {}

int gea_embedded_ble_is_connected(void) { return 0; }
int gea_embedded_ble_is_bound(void) { return 0; }
int gea_embedded_ble_get_battery_level(void) { return s_battery_level; }
const char *gea_embedded_ble_get_mac(void) { return s_mac_address; }
const char *gea_embedded_ble_get_device_name(void) { return s_device_name; }

int gea_embedded_ble_is_enabled(void) { return s_enabled; }
void gea_embedded_ble_set_enabled(int enabled) { s_enabled = enabled ? 1 : 0; }

void gea_embedded_ble_key_tap(int hid_code) { (void)hid_code; }
void gea_embedded_ble_key_down(int modifier, int hid_code) { (void)modifier; (void)hid_code; }
void gea_embedded_ble_key_up(void) {}

void gea_embedded_ble_mouse_move(int dx, int dy, int buttons, int wheel) {
	(void)dx; (void)dy; (void)buttons; (void)wheel;
}

void gea_embedded_ble_mouse_click(int button) { (void)button; }

void gea_embedded_ble_set_battery_level(uint8_t level) {
	if (level > 100) level = 100;
	s_battery_level = level;
}
