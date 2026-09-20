#include "wifi.h"

#include <string.h>

#define GEA_EMBEDDED_WIFI_SCAN_MAX 20

static int s_enabled = 1;
static int s_connected = 1;
static int s_rssi = -48;
static char s_ssid[33] = "Gea Lab";
static char s_ip[16] = "192.168.4.22";
static char s_mac[18] = "02:00:00:00:00:01";

static int s_scan_count = 0;
static char s_scan_ssids[GEA_EMBEDDED_WIFI_SCAN_MAX][33];
static int s_scan_rssi[GEA_EMBEDDED_WIFI_SCAN_MAX];
static int s_scan_secured[GEA_EMBEDDED_WIFI_SCAN_MAX];

static void copy_string(char *dst, size_t dst_size, const char *src)
{
	if (!dst || dst_size == 0) return;
	if (!src) src = "";
	strncpy(dst, src, dst_size - 1);
	dst[dst_size - 1] = '\0';
}

int gea_embedded_wifi_is_connected(void)
{
	return s_enabled ? s_connected : 0;
}

int gea_embedded_wifi_get_rssi(void)
{
	return s_enabled && s_connected ? s_rssi : 0;
}

const char *gea_embedded_wifi_get_ssid(void)
{
	return s_enabled && s_connected ? s_ssid : "";
}

const char *gea_embedded_wifi_get_ip(void)
{
	return s_enabled && s_connected ? s_ip : "0.0.0.0";
}

const char *gea_embedded_wifi_get_mac(void)
{
	return s_mac;
}

int gea_embedded_wifi_is_enabled(void)
{
	return s_enabled;
}

void gea_embedded_wifi_set_enabled(int enabled)
{
	s_enabled = enabled ? 1 : 0;
	if (!s_enabled) {
		s_connected = 0;
		s_rssi = 0;
		copy_string(s_ip, sizeof(s_ip), "0.0.0.0");
	} else if (s_ssid[0] != '\0') {
		s_connected = 1;
		s_rssi = -45;
		copy_string(s_ip, sizeof(s_ip), "192.168.4.22");
	}
}

void gea_embedded_wifi_configure(const char *ssid, const char *password)
{
	(void)password;
	copy_string(s_ssid, sizeof(s_ssid), ssid);
	if (!s_enabled || s_ssid[0] == '\0') {
		s_connected = 0;
		s_rssi = 0;
		copy_string(s_ip, sizeof(s_ip), "0.0.0.0");
		return;
	}
	s_connected = 1;
	s_rssi = -45;
	copy_string(s_ip, sizeof(s_ip), "192.168.4.22");
}

void gea_embedded_wifi_web_set_state(int connected, const char *ssid, const char *ip, int rssi)
{
	s_connected = s_enabled && connected ? 1 : 0;
	s_rssi = rssi;
	copy_string(s_ssid, sizeof(s_ssid), ssid);
	copy_string(s_ip, sizeof(s_ip), ip);
}

void gea_embedded_wifi_start_scan(void)
{
	if (!s_enabled) return;
	/* No-op in web shim. Mock list is updated externally via web_set_scan_*. */
}

int gea_embedded_wifi_is_scanning(void)
{
	return 0;
}

int gea_embedded_wifi_get_scan_count(void)
{
	if (!s_enabled) return 0;
	return s_scan_count;
}

const char *gea_embedded_wifi_get_scan_ssid_at(int index)
{
	if (index < 0 || index >= s_scan_count) return "";
	return s_scan_ssids[index];
}

int gea_embedded_wifi_get_scan_rssi_at(int index)
{
	if (index < 0 || index >= s_scan_count) return 0;
	return s_scan_rssi[index];
}

int gea_embedded_wifi_get_scan_secured_at(int index)
{
	if (index < 0 || index >= s_scan_count) return 0;
	return s_scan_secured[index];
}

void gea_embedded_wifi_web_set_scan_count(int count)
{
	if (count < 0) count = 0;
	if (count > GEA_EMBEDDED_WIFI_SCAN_MAX) count = GEA_EMBEDDED_WIFI_SCAN_MAX;
	s_scan_count = count;
}

void gea_embedded_wifi_web_set_scan_entry(int index, const char *ssid, int rssi, int secured)
{
	if (index < 0 || index >= GEA_EMBEDDED_WIFI_SCAN_MAX) return;
	copy_string(s_scan_ssids[index], sizeof(s_scan_ssids[index]), ssid);
	s_scan_rssi[index] = rssi;
	s_scan_secured[index] = secured ? 1 : 0;
}
