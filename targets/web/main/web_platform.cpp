// Web platform hooks the gea-embedded host/UI layer expects each target to
// provide (the ESP32 target backs these with PSRAM + an esp_timer scheduler;
// macOS uses malloc + mach time). On the web there is no SPIRAM and time comes
// from the browser clock.

#include "audio.h"
#include "host/media.h"
#include "imu.h"
#include "memory.h"
#include "platform/file_cache.h"
#include "services/frame_scheduler.h"
#include "touch.h"

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/em_js.h>
#include <emscripten/emscripten.h>
#endif

namespace {

bool webFileCacheMounted()
{
	return true;
}

struct WebPlatformStorageMount {
	WebPlatformStorageMount() { gea::platform::storage::setMountProvider(webFileCacheMounted); }
};

WebPlatformStorageMount g_web_platform_storage_mount;

std::vector<std::uint8_t> readWholeFile(const std::string &path)
{
	std::vector<std::uint8_t> out;
	if (path.empty()) return out;
	gea::platform::storage::ensureMounted();
	std::FILE *file = std::fopen(path.c_str(), "rb");
	if (!file) return out;
	std::fseek(file, 0, SEEK_END);
	const long size = std::ftell(file);
	std::fseek(file, 0, SEEK_SET);
	if (size > 0) {
		out.resize(static_cast<std::size_t>(size));
		const std::size_t read = std::fread(out.data(), 1, out.size(), file);
		out.resize(read);
	}
	std::fclose(file);
	return out;
}

#ifdef __EMSCRIPTEN__
EM_JS(double, gea_web_audio_current_time, (), {
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return performance.now() / 1000;
  const state = globalThis.__gea_web_audio || (globalThis.__gea_web_audio = { volume: 80, oscillators: [] });
  if (!state.context) state.context = new Ctor();
  return state.context.currentTime;
});

EM_JS(int, gea_web_audio_create_oscillator, (), {
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return 0;
  const state = globalThis.__gea_web_audio || (globalThis.__gea_web_audio = { volume: 80, oscillators: [] });
  if (!state.context) state.context = new Ctor();
  if (!state.gain) {
    state.gain = state.context.createGain();
    state.gain.gain.value = (state.volume ?? 80) / 100;
    state.gain.connect(state.context.destination);
  }
  const oscillator = state.context.createOscillator();
  const id = state.oscillators.length + 1;
  state.oscillators[id] = { oscillator, connected: false, started: false, stopped: false, type: 0 };
  return id;
});

EM_JS(double, gea_web_audio_oscillator_frequency, (int handle), {
  const entry = globalThis.__gea_web_audio?.oscillators?.[handle];
  return entry?.oscillator?.frequency?.value || 0;
});

EM_JS(void, gea_web_audio_set_oscillator_frequency, (int handle, double value), {
  const entry = globalThis.__gea_web_audio?.oscillators?.[handle];
  if (entry?.oscillator) entry.oscillator.frequency.value = value;
});

EM_JS(void, gea_web_audio_set_oscillator_frequency_at_time, (int handle, double value, double start_time), {
  const entry = globalThis.__gea_web_audio?.oscillators?.[handle];
  if (entry?.oscillator) entry.oscillator.frequency.setValueAtTime(value, start_time);
});

EM_JS(int, gea_web_audio_oscillator_type, (int handle), {
  const entry = globalThis.__gea_web_audio?.oscillators?.[handle];
  return entry?.type || 0;
});

EM_JS(void, gea_web_audio_set_oscillator_type, (int handle, int type), {
  const entry = globalThis.__gea_web_audio?.oscillators?.[handle];
  if (!entry?.oscillator) return;
  entry.type = type;
  entry.oscillator.type = type === 1 ? "square" : type === 2 ? "sawtooth" : type === 3 ? "triangle" : "sine";
});

EM_JS(void, gea_web_audio_connect_oscillator, (int handle), {
  const state = globalThis.__gea_web_audio;
  const entry = state?.oscillators?.[handle];
  if (!state?.gain || !entry?.oscillator || entry.connected) return;
  entry.oscillator.connect(state.gain);
  entry.connected = true;
});

EM_JS(void, gea_web_audio_start_oscillator, (int handle, double when), {
  const state = globalThis.__gea_web_audio;
  const entry = state?.oscillators?.[handle];
  if (!state?.context || !entry?.oscillator || entry.started) return;
  if (state.context.state === "suspended") void state.context.resume();
  try {
    entry.oscillator.start(when);
    entry.started = true;
  } catch (_) {}
});

EM_JS(void, gea_web_audio_stop_oscillator, (int handle, double when), {
  const state = globalThis.__gea_web_audio;
  const entry = state?.oscillators?.[handle];
  if (!entry?.oscillator || entry.stopped) return;
  try {
    entry.oscillator.stop(when);
    entry.stopped = true;
  } catch (_) {}
});

EM_JS(int, gea_web_audio_get_volume, (), {
  return Math.round(globalThis.__gea_web_audio?.volume ?? 80);
});

EM_JS(void, gea_web_audio_set_volume, (int volume), {
  const state = globalThis.__gea_web_audio || (globalThis.__gea_web_audio = { volume: 80, oscillators: [] });
  state.volume = Math.max(0, Math.min(100, Math.round(volume)));
  if (state.gain && state.context) {
    state.gain.gain.setValueAtTime(state.volume / 100, state.context.currentTime);
  }
});

EM_JS(int, gea_web_audio_play_bytes, (const unsigned char *data, int length), {
  if (!data || length <= 0) return 0;
  try {
    const state = globalThis.__gea_web_audio || (globalThis.__gea_web_audio = { volume: 80, oscillators: [] });
    const bytes = HEAPU8.slice(data, data + length);
    const blob = new Blob([bytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, (state.volume ?? 80) / 100));
    audio.onended = () => URL.revokeObjectURL(url);
    audio.onerror = () => URL.revokeObjectURL(url);
    const played = audio.play();
    if (played && typeof played.catch === "function") played.catch(() => URL.revokeObjectURL(url));
    state.lastPlayback = audio;
    return 1;
  } catch (_) {
    return 0;
  }
});

EM_JS(void, gea_web_media_attach_track, (int handle), {
  const root = globalThis;
  const tracks = root.__gea_web_media_tracks || (root.__gea_web_media_tracks = {});
  if (tracks[handle]) return;

  const sampleRate = 16000;
  const entry = { timers: [], phase: 0, stream: null, context: null, source: null, processor: null, mutedGain: null };
  tracks[handle] = entry;

  function injectInt16(samples) {
    if (!samples || samples.length === 0) return;
    const ptr = _malloc(samples.length * 2);
    HEAP16.set(samples, ptr >> 1);
    _gea_web_media_inject_pcm(handle, ptr, samples.length);
    _free(ptr);
  }

  function injectFloat32(input, inputRate) {
    if (!input || input.length === 0) return;
    const sourceRate = inputRate || sampleRate;
    const ratio = sourceRate / sampleRate;
    const count = Math.max(1, Math.floor(input.length / ratio));
    const pcm = new Int16Array(count);
    for (let i = 0; i < count; i++) {
      const sourceIndex = Math.min(input.length - 1, Math.floor(i * ratio));
      const sample = Math.max(-1, Math.min(1, input[sourceIndex] || 0));
      pcm[i] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    }
    injectInt16(pcm);
  }

  function startSynthetic() {
    if (entry.syntheticStarted) return;
    entry.syntheticStarted = true;
    const frequency = 220;
    const frameSamples = 320;
    const timer = setInterval(() => {
      const pcm = new Int16Array(frameSamples);
      for (let i = 0; i < frameSamples; i++) {
        const envelope = 0.55 + 0.35 * Math.sin(entry.phase * 0.07);
        pcm[i] = Math.round(Math.sin(entry.phase) * envelope * 9000);
        entry.phase += (Math.PI * 2 * frequency) / sampleRate;
        if (entry.phase > Math.PI * 2) entry.phase -= Math.PI * 2;
      }
      injectInt16(pcm);
    }, 20);
    entry.timers.push(timer);
  }

  async function startBrowserMic() {
    const mediaDevices = root.navigator && root.navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      startSynthetic();
      return;
    }
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true });
      if (!tracks[handle]) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const Ctor = root.AudioContext || root.webkitAudioContext;
      if (!Ctor) {
        stream.getTracks().forEach(track => track.stop());
        startSynthetic();
        return;
      }
      const context = new Ctor();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const mutedGain = context.createGain();
      mutedGain.gain.value = 0;
      processor.onaudioprocess = event => {
        injectFloat32(event.inputBuffer.getChannelData(0), context.sampleRate);
      };
      source.connect(processor);
      processor.connect(mutedGain);
      mutedGain.connect(context.destination);
      if (context.state === "suspended") void context.resume();
      entry.stream = stream;
      entry.context = context;
      entry.source = source;
      entry.processor = processor;
      entry.mutedGain = mutedGain;
    } catch (_) {
      startSynthetic();
    }
  }

  if (root.__GEA_FAKE_MIC__) startSynthetic();
  else void startBrowserMic();
});

EM_JS(void, gea_web_media_detach_track, (int handle), {
  const tracks = globalThis.__gea_web_media_tracks || {};
  const entry = tracks[handle];
  if (!entry) return;
  for (const timer of entry.timers || []) clearInterval(timer);
  try { entry.processor && entry.processor.disconnect(); } catch (_) {}
  try { entry.source && entry.source.disconnect(); } catch (_) {}
  try { entry.mutedGain && entry.mutedGain.disconnect(); } catch (_) {}
  try { entry.context && entry.context.close && entry.context.close(); } catch (_) {}
  try { entry.stream && entry.stream.getTracks().forEach(track => track.stop()); } catch (_) {}
  delete tracks[handle];
});
#endif

}  // namespace

#ifdef __EMSCRIPTEN__
extern "C" EMSCRIPTEN_KEEPALIVE void gea_web_media_inject_pcm(int track_handle, const std::int16_t *samples, int count)
{
	if (!samples || count <= 0) return;
	gea::host::media::track_inject_pcm(static_cast<gea::host::NativeMediaTrackHandle>(track_handle), samples,
	                                   static_cast<std::size_t>(count));
}
#endif

namespace gea::framework::memory {

void *Allocator::allocatePreferSpiram(std::size_t size, std::size_t alignment)
{
	if (size == 0) return nullptr;
	if (alignment <= alignof(std::max_align_t)) return std::malloc(size);
	void *ptr = nullptr;
	if (posix_memalign(&ptr, alignment, size) != 0) return nullptr;
	return ptr;
}

void *Allocator::reallocatePreferSpiram(void *ptr, std::size_t size)
{
	if (size == 0) {
		std::free(ptr);
		return nullptr;
	}
	return std::realloc(ptr, size);
}

void Allocator::free(void *ptr) noexcept
{
	std::free(ptr);
}

}  // namespace gea::framework::memory

namespace gea::framework::services {

namespace {
int g_frame_interval_ms = FrameScheduler::kDefaultFrameIntervalMs;

int webNowMs()
{
	using Clock = std::chrono::steady_clock;
	return static_cast<int>(
	    std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now().time_since_epoch()).count());
}
}  // namespace

// The browser drives frames via requestAnimationFrame, and application launch
// is drained per-frame in web_main.cpp (not via an event queue), so the event
// methods are inert and sendEvent simply succeeds (mirrors the macOS host).
EventQueue FrameScheduler::createEventQueue() { return EventQueue{}; }
EventQueue FrameScheduler::eventQueue() { return EventQueue{}; }
bool FrameScheduler::sendEvent(const gea::framework::events::Event &, int) { return true; }
bool FrameScheduler::receiveEvent(gea::framework::events::Event *) { return false; }
void FrameScheduler::start(EventQueue) {}
void FrameScheduler::runFrame(const FrameCallbacks &callbacks)
{
	if (callbacks.frame) callbacks.frame(webNowMs(), callbacks.context);
}
void FrameScheduler::setFrameIntervalMs(int intervalMs)
{
	if (intervalMs < kMinFrameIntervalMs) intervalMs = kMinFrameIntervalMs;
	if (intervalMs > kMaxFrameIntervalMs) intervalMs = kMaxFrameIntervalMs;
	g_frame_interval_ms = intervalMs;
}
int FrameScheduler::frameIntervalMs() { return g_frame_interval_ms; }
void FrameScheduler::setFrameRate(double fps)
{
	if (fps <= 0.0) return;
	setFrameIntervalMs(static_cast<int>(1000.0 / fps + 0.5));
}
double FrameScheduler::frameRate() { return 1000.0 / static_cast<double>(g_frame_interval_ms); }
int FrameScheduler::nowMs() { return webNowMs(); }

}  // namespace gea::framework::services

// Web platform bridges for browser audio/media plus inert sensor diagnostics.
// Touch polling is backed by app_touch_* entry points from the simulator.

namespace gea::platform::audio {

namespace {
int g_volume = 80;
}

AudioParam::AudioParam(NativeAudioHandle oscillator) : oscillator_(oscillator) {}
double AudioParam::value() const
{
#ifdef __EMSCRIPTEN__
	return gea_web_audio_oscillator_frequency(static_cast<int>(oscillator_));
#else
	return 0.0;
#endif
}
void AudioParam::setValue(double value)
{
#ifdef __EMSCRIPTEN__
	gea_web_audio_set_oscillator_frequency(static_cast<int>(oscillator_), value);
#else
	(void)value;
#endif
}
void AudioParam::setValueAtTime(double value, double start_time)
{
#ifdef __EMSCRIPTEN__
	gea_web_audio_set_oscillator_frequency_at_time(static_cast<int>(oscillator_), value, start_time);
#else
	(void)value;
	(void)start_time;
#endif
}

AudioNode::AudioNode(NativeAudioHandle native) : native_(native) {}
NativeAudioHandle AudioNode::nativeId() const { return native_; }

AudioDestinationNode::AudioDestinationNode(NativeAudioHandle native) : AudioNode(native) {}

OscillatorNode::OscillatorNode(NativeAudioHandle native) : AudioNode(native), frequency(native) {}
OscillatorType OscillatorNode::type() const
{
#ifdef __EMSCRIPTEN__
	return static_cast<OscillatorType>(gea_web_audio_oscillator_type(static_cast<int>(nativeId())));
#else
	return OscillatorType::Sine;
#endif
}
void OscillatorNode::setType(OscillatorType type)
{
#ifdef __EMSCRIPTEN__
	gea_web_audio_set_oscillator_type(static_cast<int>(nativeId()), static_cast<int>(type));
#else
	(void)type;
#endif
}
void OscillatorNode::connect(const AudioDestinationNode &)
{
#ifdef __EMSCRIPTEN__
	gea_web_audio_connect_oscillator(static_cast<int>(nativeId()));
#endif
}
void OscillatorNode::start(double when)
{
#ifdef __EMSCRIPTEN__
	gea_web_audio_start_oscillator(static_cast<int>(nativeId()), when);
#else
	(void)when;
#endif
}
void OscillatorNode::stop(double when)
{
#ifdef __EMSCRIPTEN__
	gea_web_audio_stop_oscillator(static_cast<int>(nativeId()), when);
#else
	(void)when;
#endif
}

double AudioContext::currentTime() const
{
#ifdef __EMSCRIPTEN__
	return gea_web_audio_current_time();
#else
	return 0.0;
#endif
}
AudioDestinationNode AudioContext::destination() const { return AudioDestinationNode(1); }
OscillatorNode AudioContext::createOscillator() const
{
#ifdef __EMSCRIPTEN__
	return OscillatorNode(static_cast<NativeAudioHandle>(gea_web_audio_create_oscillator()));
#else
	return OscillatorNode(0);
#endif
}

AudioContext AudioSystem::sharedContext() { return AudioContext{}; }
int AudioSystem::volume()
{
#ifdef __EMSCRIPTEN__
	g_volume = gea_web_audio_get_volume();
#endif
	return g_volume;
}
bool AudioSystem::playFile(const std::string &path)
{
	// Web/simulator audio: hand the encoded file bytes to the browser, which
	// decodes + streams them itself. (The device path streams from disk in
	// audio_runtime.cpp; here the whole-file read is fine — the browser owns
	// playback and this path is not exercised by the static e-paper UI test.)
	const std::vector<std::uint8_t> bytes = readWholeFile(path);
	if (bytes.empty()) return false;
#ifdef __EMSCRIPTEN__
	return gea_web_audio_play_bytes(bytes.data(), static_cast<int>(bytes.size())) != 0;
#else
	(void)bytes;
	return false;
#endif
}
void AudioSystem::stopPlayback()
{
	// Web/simulator: the browser owns playback lifecycle; nothing to stop here.
}
void AudioSystem::setVolume(int v)
{
	if (v < 0) v = 0;
	if (v > 100) v = 100;
	g_volume = v;
#ifdef __EMSCRIPTEN__
	gea_web_audio_set_volume(g_volume);
#endif
}

}  // namespace gea::platform::audio

namespace gea::host::media {

void platform_attach_track(NativeMediaTrackHandle handle)
{
#ifdef __EMSCRIPTEN__
	gea_web_media_attach_track(static_cast<int>(handle));
#else
	(void)handle;
#endif
}

void platform_detach_track(NativeMediaTrackHandle handle)
{
#ifdef __EMSCRIPTEN__
	gea_web_media_detach_track(static_cast<int>(handle));
#else
	(void)handle;
#endif
}

}  // namespace gea::host::media

namespace gea::platform::sensors {

void Accelerometer::init() {}
void Accelerometer::close() {}
void Accelerometer::calibrateBias() {}
int Accelerometer::tiltX() { return 0; }
int Accelerometer::tiltY() { return 0; }
double Accelerometer::accelerationX() { return 0.0; }
double Accelerometer::accelerationY() { return 0.0; }
double Accelerometer::accelerationZ() { return 9.80665; }
double Accelerometer::gyroscopeX() { return 0.0; }
double Accelerometer::gyroscopeY() { return 0.0; }
double Accelerometer::gyroscopeZ() { return 0.0; }
void Accelerometer::setWebTilt(int, int) {}

}  // namespace gea::platform::sensors

namespace gea::platform::memory {

std::uint32_t Memory::internalFree() { return 0; }
std::uint32_t Memory::internalLargestFreeBlock() { return 0; }
std::uint32_t Memory::internalMinimumFree() { return 0; }
std::uint32_t Memory::psramFree() { return 0; }
std::uint32_t Memory::currentTaskStackHighWaterMark() { return 0; }
std::uint32_t Memory::geaMainStackBytes() { return 0; }
std::uint32_t Memory::geaInitStackBytes() { return 0; }
std::uint32_t Memory::appFrameStackWords() { return 0; }
std::uint32_t Memory::appFrameStackBytes() { return 0; }
std::uint32_t Memory::displayFlushConfiguredRows() { return 0; }
std::uint32_t Memory::displayFlushConfiguredDepth() { return 0; }
std::uint32_t Memory::displayFlushBufferMaxBytes() { return 0; }
std::uint32_t Memory::displayFlushRows() { return 0; }
std::uint32_t Memory::displayFlushDepth() { return 0; }
std::uint32_t Memory::displayFlushBufferBytes() { return 0; }

// No internal/external split here, so there is nothing to hold back for the
// display; the caller treats nullptr as "no reserve" and carries on.
void *Memory::reserveInternalDma(std::size_t) { return nullptr; }
void Memory::releaseInternalDma(void *) {}
}  // namespace gea::platform::memory

namespace gea::platform::touch {

namespace {
Touchscreen::Observer g_observer = nullptr;
bool g_touching = false;
int g_touch_x = 0;
int g_touch_y = 0;
}  // namespace

void Touchscreen::setObserver(Observer observer) { g_observer = observer; }
bool Touchscreen::init() { return true; }
int Touchscreen::read(int *x, int *y)
{
	if (x) *x = g_touch_x;
	if (y) *y = g_touch_y;
	return g_touching ? 1 : 0;
}
int Touchscreen::readCached(int *x, int *y)
{
	if (x) *x = g_touch_x;
	if (y) *y = g_touch_y;
	return g_touching ? 1 : 0;
}
void Touchscreen::consumeLatestMove(int *x, int *y)
{
	if (x) *x = g_touch_x;
	if (y) *y = g_touch_y;
}
void Touchscreen::injectEvent(Phase phase, bool touching, int x, int y)
{
	g_touching = touching;
	g_touch_x = x;
	g_touch_y = y;
	if (g_observer) g_observer(phase, touching, x, y);
}

}  // namespace gea::platform::touch
