import { fetchAsync, fetchReady, fetchResult, fetchRelease } from '@geastack/core'

Object.assign(globalThis, { hostApi: { fetchAsync, fetchReady, fetchResult, fetchRelease } })
