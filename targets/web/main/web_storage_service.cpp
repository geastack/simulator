#include "services/storage_service.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <unordered_map>

#ifdef __EMSCRIPTEN__
#include <emscripten/em_js.h>
#endif

namespace gea::framework::services {

namespace {

#ifdef __EMSCRIPTEN__
constexpr const char *kLocalStorageBlobKey = "__gea_embedded_local_storage_blob_hex_v1";

EM_JS(int, gea_web_storage_get_string, (const char *key_ptr, char *buf, int capacity), {
  if (!key_ptr || !buf || capacity <= 0) return 0;
  try {
    const storage = globalThis.localStorage;
    if (!storage) return 0;
    const value = storage.getItem(UTF8ToString(key_ptr));
    if (value === null) return 0;
    stringToUTF8(value, buf, capacity);
    return 1;
  } catch (_) {
    return 0;
  }
});

EM_JS(int, gea_web_storage_set_string, (const char *key_ptr, const char *value_ptr), {
  if (!key_ptr || !value_ptr) return 0;
  try {
    const storage = globalThis.localStorage;
    if (!storage) return 0;
    storage.setItem(UTF8ToString(key_ptr), UTF8ToString(value_ptr));
    return 1;
  } catch (_) {
    return 0;
  }
});

EM_JS(int, gea_web_storage_prepare_kv_blob, (const char *internal_key_ptr), {
  const internalKey = UTF8ToString(internal_key_ptr);
  const bytes = [];
  const encoder = new TextEncoder();

  function appendU32(value) {
    bytes.push(value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255);
  }

  function appendChunk(text) {
    const encoded = encoder.encode(String(text));
    appendU32(encoded.length);
    for (let i = 0; i < encoded.length; i++) bytes.push(encoded[i]);
  }

  try {
    const storage = globalThis.localStorage;
    if (storage) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) || "";
        if (!key || key === internalKey || key.startsWith("__gea_")) continue;
        const value = storage.getItem(key);
        if (value === null) continue;
        appendChunk(key);
        appendChunk(value);
      }

      const savedHex = storage.getItem(internalKey) || "";
      for (let i = 0; i + 1 < savedHex.length; i += 2) {
        const byte = Number.parseInt(savedHex.slice(i, i + 2), 16);
        if (Number.isFinite(byte)) bytes.push(byte & 255);
      }
    }
  } catch (_) {}

  globalThis.__gea_embedded_prepared_storage_blob = new Uint8Array(bytes);
  return bytes.length;
});

EM_JS(void, gea_web_storage_read_prepared_kv_blob, (unsigned char *out, int capacity), {
  const bytes = globalThis.__gea_embedded_prepared_storage_blob || new Uint8Array(0);
  const length = Math.min(capacity, bytes.length);
  HEAPU8.set(bytes.subarray(0, length), out);
});

EM_JS(void, gea_web_storage_save_kv_blob, (const unsigned char *data, int length, const char *internal_key_ptr), {
  const internalKey = UTF8ToString(internal_key_ptr);
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const chunks = [];
    for (let i = 0; i < length; i++) chunks.push(HEAPU8[data + i].toString(16).padStart(2, "0"));
    storage.setItem(internalKey, chunks.join(""));
  } catch (_) {}
});
#endif

std::unordered_map<std::string, std::string> &storage()
{
	static std::unordered_map<std::string, std::string> values;
	return values;
}

std::string &localStorageBlob()
{
	static std::string blob;
	return blob;
}

}  // namespace

bool StorageService::init()
{
	return true;
}

bool StorageService::getString(const char *key, char *buf, unsigned capacity)
{
	if (!key || !buf || capacity == 0) return false;
#ifdef __EMSCRIPTEN__
	return gea_web_storage_get_string(key, buf, static_cast<int>(capacity)) != 0;
#else
	auto it = storage().find(key);
	if (it == storage().end()) return false;
	const std::size_t copyLength = it->second.copy(buf, capacity - 1);
	buf[copyLength] = '\0';
	return true;
#endif
}

bool StorageService::setString(const char *key, const char *value)
{
	if (!key || !value) return false;
#ifdef __EMSCRIPTEN__
	return gea_web_storage_set_string(key, value) != 0;
#else
	storage()[key] = value;
	return true;
#endif
}

bool StorageService::loadKv(std::string &out)
{
#ifdef __EMSCRIPTEN__
	const int length = gea_web_storage_prepare_kv_blob(kLocalStorageBlobKey);
	if (length <= 0) {
		out.clear();
		return false;
	}
	out.resize(static_cast<std::size_t>(length));
	gea_web_storage_read_prepared_kv_blob(reinterpret_cast<std::uint8_t *>(out.data()), length);
	return true;
#else
	out = localStorageBlob();
	return !out.empty();
#endif
}

void StorageService::saveKv(const std::string &blob)
{
#ifdef __EMSCRIPTEN__
	gea_web_storage_save_kv_blob(reinterpret_cast<const std::uint8_t *>(blob.data()),
	                             static_cast<int>(blob.size()), kLocalStorageBlobKey);
#else
	localStorageBlob() = blob;
#endif
}

}  // namespace gea::framework::services
