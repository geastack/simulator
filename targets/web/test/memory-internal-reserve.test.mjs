// Every platform that implements the Gea Memory API must implement the
// display's internal-RAM reserve too, or the link breaks on this target instead
// of on the board someone is holding.
//
// It lives next to the file it is about, so it runs wherever this package
// does rather than only where some particular set of repos is checked out.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const platform = readFileSync(new URL('../main/web_platform.cpp', import.meta.url), 'utf8')

assert.match(platform, /Memory::reserveInternalDma\(std::size_t\)/, 'web_platform.cpp must define reserveInternalDma')
assert.match(platform, /Memory::releaseInternalDma\(void \*\)/, 'web_platform.cpp must define releaseInternalDma')
