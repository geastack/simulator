declare module '*.css'

// Compile-time constants substituted by simulator/vite.config.ts's `define`.
// Both are optional: the dev server may be driven by the `gea` CLI from outside
// this checkout, or run in-repo with no env at all, and vitest applies no define
// whatsoever — so every reader must guard with `typeof`.

/** Absolute filesystem path of the web build's dist root (`targets/web/dist`). */
declare const __GEA_WEB_DIST_FS_ROOT__: string | undefined

/** App index supplied by the driver; falls back to src/generated/app-index.ts. */
declare const __GEA_APP_INDEX__: readonly unknown[] | undefined
