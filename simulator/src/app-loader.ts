type WasmModule = {
  HEAPU8: Uint8Array
  ccall: (ident: string, returnType: string | null, argTypes: string[], args: unknown[]) => number
}

type WasmModuleOptions = {
  locateFile?: (path: string, scriptDirectory: string) => string
}

// __GEA_WEB_DIST_FS_ROOT__ is declared once, in src/vite-env.d.ts, beside the
// other compile-time constants simulator/vite.config.ts defines.

type WasmModuleFactory = (options?: WasmModuleOptions) => Promise<WasmModule>
type WasmModuleNamespace = { default: WasmModuleFactory }

const wasmModuleLoaders = import.meta.glob('../../targets/web/dist/*/module.js') as Record<
  string,
  () => Promise<WasmModuleNamespace>
>

let activeAppScript: HTMLScriptElement | null = null

export function getModuleImportKey(appId: string): string {
  return `../../targets/web/dist/${appId}/module.js`
}

export function getModuleDevImportUrl(appId: string): string {
  const root = typeof __GEA_WEB_DIST_FS_ROOT__ === 'string' ? __GEA_WEB_DIST_FS_ROOT__.replace(/\/$/, '') : ''
  return root ? `/@fs/${root}/${appId}/module.js` : getModuleImportKey(appId)
}

export function getAppScriptUrl(appId: string, cacheBust: string): string {
  return `/apps/${appId}/app.js?v=${cacheBust}`
}

export function getModuleWasmUrl(appId: string, cacheBust?: string): string {
  const suffix = cacheBust ? `?v=${cacheBust}` : ''
  return `/apps/${appId}/module.wasm${suffix}`
}

export function getModuleAssetUrl(appId: string, path: string, cacheBust?: string): string {
  const suffix = cacheBust ? `?v=${cacheBust}` : ''
  return `/apps/${appId}/${path}${suffix}`
}

export async function loadModule(appId: string): Promise<WasmModule> {
  const importKey = getModuleImportKey(appId)
  const cacheBust = String(Date.now())
  let moduleNamespace: WasmModuleNamespace | null = null

  if (import.meta.env.DEV) {
    try {
      moduleNamespace = (await import(/* @vite-ignore */ `${getModuleDevImportUrl(appId)}?v=${cacheBust}`)) as WasmModuleNamespace
    } catch {
      moduleNamespace = null
    }
  }

  const moduleLoader = wasmModuleLoaders[importKey]
  if (!moduleNamespace && moduleLoader) {
    moduleNamespace = await moduleLoader()
  }

  if (!moduleNamespace) {
    throw new Error(`Missing built WASM module for app "${appId}". Run ./targets/web/build-web.sh ${appId}.`)
  }

  const moduleFactory = moduleNamespace.default
  return moduleFactory({
    locateFile(path) {
      const version = import.meta.env.DEV ? cacheBust : undefined
      return path === 'module.wasm' ? getModuleWasmUrl(appId, version) : getModuleAssetUrl(appId, path, version)
    }
  })
}

export async function loadAppScript(appId: string, cacheBust: string): Promise<void> {
  const nextScript = document.createElement('script')
  nextScript.type = 'module'
  nextScript.src = getAppScriptUrl(appId, cacheBust)

  await new Promise<void>((resolve, reject) => {
    nextScript.onload = () => {
      activeAppScript?.remove()
      activeAppScript = nextScript
      resolve()
    }

    nextScript.onerror = () => {
      nextScript.remove()
      reject(new Error(`Failed to load app bundle for "${appId}".`))
    }

    document.head.append(nextScript)
  })
}
