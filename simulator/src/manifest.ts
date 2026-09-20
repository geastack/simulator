import { GEA_APPS } from './generated/app-index'

export interface AppEntry {
  id: string
  root: string
  entry: string
  runtime: 'gea' | 'apple-native'
  targets?: Record<string, boolean | { enabled?: boolean } | undefined>
}

// `__GEA_APP_INDEX__` is substituted by vite's `define` from GEA_APP_INDEX_JSON
// when a driver (the `gea` CLI) supplies the index for an app tree outside this
// checkout. Unset, `define` substitutes the literal `undefined` — and under
// vitest, which applies no define, the identifier is simply absent; `typeof`
// answers "undefined" in both cases, so the checked-in app-index below stays the
// in-repo fallback and this module never throws on a bare identifier.
const suppliedApps = typeof __GEA_APP_INDEX__ === 'undefined' ? undefined : __GEA_APP_INDEX__

const apps = (suppliedApps ?? (GEA_APPS as unknown)) as readonly AppEntry[]

// Two index producers spell an enabled target differently: the checked-in
// src/generated/app-index.ts writes the object form `{ enabled: true }`, while
// the CLI's own app listing writes the boolean form `true`. Reading only one of
// them yields an empty WEB_APP_IDS and an empty picker, with no error anywhere.
function isTargetEnabled(target: boolean | { enabled?: boolean } | undefined): boolean {
  if (typeof target === 'boolean') return target
  return target?.enabled === true
}

export function isWebGeaApp(app: AppEntry): boolean {
  return app.runtime === 'gea' && isTargetEnabled(app.targets?.web)
}

const generatedWebAppIds = apps.filter(isWebGeaApp).map(app => app.id)

// External apps built into targets/web/dist but not in the auto-generated
// app-index (they live outside examples/, e.g. an app in a separate repository built with
// GEA_EXTRA_APP_DIRS). The app-loader globs dist/<id>/module.js, so listing
// the id here is enough for the picker to load it.
//
// This list is an in-repo stopgap: when the CLI supplies __GEA_APP_INDEX__ it
// already names every app it built, so the index supersedes these ids (they are
// still appended, and still harmless — the picker only reaches an id that has a
// built module).
const EXTERNAL_WEB_APP_IDS = ['mindy']

export const WEB_APP_IDS = [
  ...generatedWebAppIds,
  ...EXTERNAL_WEB_APP_IDS.filter(id => !generatedWebAppIds.includes(id)),
]
