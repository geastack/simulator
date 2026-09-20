#!/usr/bin/env node
// Make-style up-to-date check for the web build's object files.
//
// build-web.sh compiles every TU with `-MD -MT <final obj> -MF <obj>.d`, so each
// object carries the complete prerequisite list clang actually opened — the
// source, every project header, and every emscripten sysroot header. This script
// answers, for a batch of objects at once, "would recompiling produce the same
// bytes?" using the same rule make/ninja use: an object is up to date when it
// exists, its depfile exists and names it as the target, and no prerequisite is
// missing or newer than it.
//
// It is a batch tool because the depfiles are large (~850 prerequisites per TU,
// ~75k across a build) and heavily overlapping; a per-file shell loop would cost
// more than the compiles it saves. Prerequisite stats are memoized across the
// whole batch.
//
// Protocol: object paths as arguments (each object's depfile is `<obj>.d`), one
// line of `fresh` or `stale` on stdout per argument, in order. Anything
// unreadable, unparseable or ambiguous answers `stale` — never fail open.
import fs from 'node:fs'
import path from 'node:path'

const mtimeCache = new Map()

function mtimeOf(filePath) {
  if (mtimeCache.has(filePath)) return mtimeCache.get(filePath)
  let value = null
  try {
    value = fs.statSync(filePath).mtimeMs
  } catch {
    value = null
  }
  mtimeCache.set(filePath, value)
  return value
}

// Make escaping: `\ ` for spaces, `\\` for a backslash, `$$` for a literal `$`,
// and a trailing backslash-newline for line continuation.
function splitMakeWords(text) {
  const words = []
  let current = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\') {
      const next = text[index + 1]
      if (next === ' ' || next === '\\' || next === '#' || next === ':') {
        current += next
        index += 1
        continue
      }
      if (next === '\n' || next === '\r') continue
      current += char
      continue
    }
    if (char === '$' && text[index + 1] === '$') {
      current += '$'
      index += 1
      continue
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      if (current) words.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) words.push(current)
  return words
}

// Returns { target, prerequisites } for the first rule in a depfile, or null.
function parseDepfile(text) {
  const separator = text.indexOf(':')
  if (separator < 0) return null
  const targets = splitMakeWords(text.slice(0, separator))
  const prerequisites = splitMakeWords(text.slice(separator + 1))
  if (targets.length !== 1 || prerequisites.length === 0) return null
  return { target: targets[0], prerequisites }
}

function isUpToDate(objectPath) {
  const objectMtime = mtimeOf(objectPath)
  if (objectMtime === null) return false
  let depText
  try {
    depText = fs.readFileSync(`${objectPath}.d`, 'utf8')
  } catch {
    return false
  }
  const parsed = parseDepfile(depText)
  if (!parsed) return false
  // The depfile must belong to THIS object: `-MT` records the final object path
  // even when the compiler wrote to a temporary, so a mismatch means the pair is
  // not a matched set and must be rebuilt.
  if (path.resolve(parsed.target) !== path.resolve(objectPath)) return false
  for (const prerequisite of parsed.prerequisites) {
    const prerequisiteMtime = mtimeOf(prerequisite)
    if (prerequisiteMtime === null) return false
    if (prerequisiteMtime > objectMtime) return false
  }
  return true
}

const objects = process.argv.slice(2)
process.stdout.write(objects.map((objectPath) => (isUpToDate(objectPath) ? 'fresh' : 'stale')).join('\n') + (objects.length ? '\n' : ''))
