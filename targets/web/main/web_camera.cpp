// Web simulator camera backend — stub.
//
// gea::platform::camera::Camera is a per-target platform driver (the esp32-p4
// backend drives a real sensor). The browser/WASM simulator has no camera, so
// this provides the link-time backend the host facade (host/camera.cpp) calls
// into, reporting "no camera available". <camera> apps degrade gracefully
// (isAvailable()=false) instead of failing to link. A future enhancement could
// wire getUserMedia here.

#include "camera.h"

namespace gea::platform::camera {

bool Camera::isAvailable() { return false; }
bool Camera::hasPermission() { return false; }
bool Camera::requestPermission() { return false; }

bool Camera::open(const std::string & /*facingHint*/, int /*preferredWidth*/, int /*preferredHeight*/) { return false; }
void Camera::close() {}
bool Camera::isOpen() { return false; }

int Camera::width() { return 0; }
int Camera::height() { return 0; }
int Camera::orientation() { return 0; }
Facing Camera::currentFacing() { return Facing::Back; }
std::string Camera::currentFacingString() { return "back"; }

int Camera::deviceCount() { return 0; }
DeviceInfo Camera::deviceAt(int /*index*/) { return DeviceInfo{}; }

void Camera::drawPreview(int /*x*/, int /*y*/, int /*destW*/, int /*destH*/) {}

int Camera::previewMode() { return 0; }  // Framebuffer
bool Camera::fillPreview(std::uint16_t * /*dst*/, int /*dstWidth*/, int /*dstHeight*/, int /*fit*/, bool /*mirror*/) { return false; }

void Camera::positionPreviewLayer(int /*x*/, int /*y*/, int /*width*/, int /*height*/) {}
void Camera::hidePreviewLayer() {}
void Camera::presentNativeOverlay() {}

int Camera::capture(bool /*mirror*/) { return -1; }

bool Camera::startRecording(const std::string & /*path*/, double /*fps*/) { return false; }
double Camera::stopRecording() { return -1; }
bool Camera::isRecording() { return false; }

void Camera::setFlash(const std::string & /*mode*/) {}
void Camera::setZoom(double /*factor*/) {}
void Camera::setMirror(bool /*mirror*/) {}

void Camera::setExposure(const std::string & /*mode*/, double /*bias*/, double /*iso*/, double /*durationMs*/) {}
void Camera::setWhiteBalance(const std::string & /*mode*/, double /*temperatureK*/, double /*tint*/) {}
void Camera::setFocus(const std::string & /*mode*/, double /*pointX*/, double /*pointY*/) {}
void Camera::setTorch(const std::string & /*mode*/, double /*level*/) {}

}  // namespace gea::platform::camera
