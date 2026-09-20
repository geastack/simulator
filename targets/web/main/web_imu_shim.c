#include "imu.h"

#include <math.h>

static int s_mouse_buttons = 0;
static int s_tilt_x = 0;
static int s_tilt_y = 0;

#define STANDARD_GRAVITY 9.80665

void gea_embedded_imu_init(void) {}
void gea_embedded_imu_close(void) {}

void gea_embedded_imu_calibrate_bias(void) {}

void gea_embedded_imu_start_mouse(void) {}
void gea_embedded_imu_stop_mouse(void) {}

int gea_embedded_imu_get_tilt_x(void) { return s_tilt_x; }
int gea_embedded_imu_get_tilt_y(void) { return s_tilt_y; }

static double tilt_to_g(int tilt)
{
    double v = ((double)tilt) / 70.0;
    if (v < -1.0) return -1.0;
    if (v > 1.0) return 1.0;
    return v;
}

double gea_embedded_imu_get_acceleration_x(void)
{
    return -tilt_to_g(s_tilt_y) * STANDARD_GRAVITY;
}

double gea_embedded_imu_get_acceleration_y(void)
{
    return tilt_to_g(s_tilt_x) * STANDARD_GRAVITY;
}

double gea_embedded_imu_get_acceleration_z(void)
{
    double xg = tilt_to_g(s_tilt_y);
    double yg = tilt_to_g(s_tilt_x);
    double zg2 = 1.0 - xg * xg - yg * yg;
    return sqrt(zg2 > 0.0 ? zg2 : 0.0) * STANDARD_GRAVITY;
}

void gea_embedded_imu_set_mouse_buttons(int buttons) { s_mouse_buttons = buttons; }
int gea_embedded_imu_get_mouse_buttons(void) { return s_mouse_buttons; }

void gea_embedded_imu_web_set_tilt(int x, int y)
{
    if (x < -100) x = -100;
    if (x > 100) x = 100;
    if (y < -100) y = -100;
    if (y > 100) y = 100;
    s_tilt_x = x;
    s_tilt_y = y;
}
