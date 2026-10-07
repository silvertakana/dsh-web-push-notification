import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPushRoutes,
  CONFIG_PATH,
  NOTIFICATION_BADGE_PATH,
  NOTIFICATION_ICON_PATH,
  SERVICE_WORKER_PATH,
} from '../src/routes.ts'
import type { PushSender } from '../src/sender.ts'
import { PushStore } from '../src/store.ts'

const subscription = {
  endpoint: 'https://push.example.test/send/one',
  expirationTime: null,
  keys: { p256dh: 'AQID', auth: 'BAUG' },
  preferences: { turnCompleted: true, turnFailed: true, approval: true, question: true, bodyMode: 'full' as const },
}

let root: string | undefined
const authenticated = () => undefined

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

function request(method: string, body?: unknown, contentType = 'application/json'): IncomingMessage {
  const raw = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    headers:
      raw === ''
        ? { host: '127.0.0.1' }
        : { host: '127.0.0.1', 'content-type': contentType, 'content-length': String(Buffer.byteLength(raw)) },
    async *[Symbol.asyncIterator]() {
      if (raw !== '') yield Buffer.from(raw)
    },
  } as unknown as IncomingMessage
}

function response(): {
  response: ServerResponse
  status: number
  headers: Record<string, unknown>
  body: unknown
  raw: unknown
} {
  let status = 0
  let headers: Record<string, unknown> = {}
  let body: unknown
  let raw: unknown
  const value = {
    response: {
      writeHead(code: number, written?: Record<string, unknown>) {
        status = code
        headers = written ?? {}
      },
      end(value?: unknown) {
        raw = value
        const text = value === undefined ? undefined : String(value)
        try {
          body = text === undefined ? undefined : JSON.parse(text)
        } catch {
          body = text
        }
      },
    } as unknown as ServerResponse,
    get status() {
      return status
    },
    get headers() {
      return headers
    },
    get body() {
      return body
    },
    get raw() {
      return raw
    },
  }
  return value
}

function find(path: string, routes: ReturnType<typeof createPushRoutes>) {
  const route = routes.find((item) => item.path === path)
  if (route === undefined) throw new Error(`missing route ${path}`)
  return route
}

describe('Web Push routes', () => {
  it('serves public configuration and a push-only Service Worker', async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-web-push-routes-'))
    const store = PushStore.open(join(root, 'state.json'), () => ({ publicKey: 'AQID', privateKey: 'BAUG' }))
    const sender: PushSender = { send: vi.fn(async () => {}) }
    const routes = createPushRoutes({ store, sender, maxRequestBodyBytes: 1024, requestRejection: authenticated })
    const config = response()
    await find(CONFIG_PATH, routes).handler(request('GET'), config.response)
    expect(config.status).toBe(200)
    expect(config.body).toEqual({
      publicKey: 'AQID',
      serviceWorkerUrl: SERVICE_WORKER_PATH,
      serviceWorkerScope: '/__dsh/web-push/',
    })

    const worker = response()
    await find(SERVICE_WORKER_PATH, routes).handler(request('GET'), worker.response)
    expect(worker.status).toBe(200)
  })

  it('stores subscriptions and removes expired endpoints after a 410', async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-web-push-routes-'))
    const store = PushStore.open(join(root, 'state.json'), () => ({ publicKey: 'AQID', privateKey: 'BAUG' }))
    const sender: PushSender = {
      send: vi.fn(async (value) => {
        if (value.endpoint.endsWith('/one')) throw Object.assign(new Error('gone'), { statusCode: 410 })
      }),
    }
    const routes = createPushRoutes({ store, sender, maxRequestBodyBytes: 1024, requestRejection: authenticated })
    const subscribe = response()
    await find('/__dsh/web-push/subscribe', routes).handler(request('POST', subscription), subscribe.response)
    expect(subscribe.status).toBe(200)
    expect(store.list()).toHaveLength(1)

    const test = response()
    await find('/__dsh/web-push/test', routes).handler(request('POST', {}), test.response)
    expect(test.body).toEqual({ sent: 0, removed: 1, failed: 0 })
    expect(store.list()).toEqual([])
  })

  it('keeps a failed delivery from rejecting the test route', async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-web-push-routes-'))
    const store = PushStore.open(join(root, 'state.json'), () => ({ publicKey: 'AQID', privateKey: 'BAUG' }))
    store.upsert(subscription)
    const routes = createPushRoutes({
      store,
      sender: {
        send: vi.fn(async () => {
          throw new Error('network down')
        }),
      },
      maxRequestBodyBytes: 1024,
      requestRejection: authenticated,
    })
    const test = response()
    await find('/__dsh/web-push/test', routes).handler(request('POST', {}), test.response)
    expect(test.status).toBe(200)
    expect(test.body).toEqual({ sent: 0, removed: 0, failed: 1 })
    expect(store.list()).toHaveLength(1)
  })

  it('reports malformed client input without presenting a server failure', async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-web-push-routes-'))
    const store = PushStore.open(join(root, 'state.json'), () => ({ publicKey: 'AQID', privateKey: 'BAUG' }))
    const routes = createPushRoutes({
      store,
      sender: { send: vi.fn(async () => {}) },
      maxRequestBodyBytes: 1024,
      requestRejection: authenticated,
    })

    const invalidSubscription = response()
    await find('/__dsh/web-push/subscribe', routes).handler(
      request('POST', { ...subscription, endpoint: 'http://push.example.test/send/one' }),
      invalidSubscription.response,
    )
    expect(invalidSubscription.status).toBe(400)
    expect(invalidSubscription.body).toEqual({
      error: 'subscription endpoint must be an HTTPS URL without credentials or a fragment',
    })

    const invalidContentType = response()
    await find('/__dsh/web-push/subscribe', routes).handler(
      request('POST', subscription, 'application/jsonp'),
      invalidContentType.response,
    )
    expect(invalidContentType.status).toBe(415)
  })

  it('rejects requests that are not authenticated by the Harness connection', async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-web-push-routes-'))
    const store = PushStore.open(join(root, 'state.json'), () => ({ publicKey: 'AQID', privateKey: 'BAUG' }))
    const routes = createPushRoutes({
      store,
      sender: { send: vi.fn(async () => {}) },
      maxRequestBodyBytes: 1024,
      requestRejection: () => 401,
    })
    const result = response()
    await find(CONFIG_PATH, routes).handler(request('GET'), result.response)
    expect(result.status).toBe(401)
    expect(result.body).toBe('unauthorized')
  })

  it('forwards caller-supplied copy to the test notification', async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-web-push-routes-'))
    const store = PushStore.open(join(root, 'state.json'), () => ({ publicKey: 'AQID', privateKey: 'BAUG' }))
    store.upsert(subscription)
    const sent: string[] = []
    const routes = createPushRoutes({
      store,
      sender: { send: async (_subscription, payload) => void sent.push(String(payload)) },
      maxRequestBodyBytes: 4096,
      requestRejection: authenticated,
    })

    const test = response()
    await find('/__dsh/web-push/test', routes).handler(
      request('POST', { title: 'Build finished', body: 'line one\nline two' }),
      test.response,
    )
    expect(test.status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0] ?? '{}')).toMatchObject({
      title: 'Build finished',
      body: 'line one\nline two',
    })
  })

  it('keeps the original copy when the test request carries none', async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-web-push-routes-'))
    const store = PushStore.open(join(root, 'state.json'), () => ({ publicKey: 'AQID', privateKey: 'BAUG' }))
    store.upsert(subscription)
    const sent: string[] = []
    const routes = createPushRoutes({
      store,
      sender: { send: async (_subscription, payload) => void sent.push(String(payload)) },
      maxRequestBodyBytes: 1024,
      requestRejection: authenticated,
    })

    const test = response()
    await find('/__dsh/web-push/test', routes).handler(request('POST', {}), test.response)
    expect(test.status).toBe(200)
    expect(JSON.parse(sent[0] ?? '{}')).toMatchObject({
      title: 'DeepSeek Harness',
      body: 'Web Push is working.',
    })
  })

  it('reports invalid test copy without sending anything', async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-web-push-routes-'))
    const store = PushStore.open(join(root, 'state.json'), () => ({ publicKey: 'AQID', privateKey: 'BAUG' }))
    store.upsert(subscription)
    let deliveries = 0
    const routes = createPushRoutes({
      store,
      sender: {
        send: async () => {
          deliveries += 1
        },
      },
      maxRequestBodyBytes: 4096,
      requestRejection: authenticated,
    })

    const notAString = response()
    await find('/__dsh/web-push/test', routes).handler(request('POST', { title: 42 }), notAString.response)
    expect(notAString.status).toBe(400)
    expect(notAString.body).toEqual({ error: 'test notification title must be a string' })

    const tooLong = response()
    await find('/__dsh/web-push/test', routes).handler(request('POST', { body: 'x'.repeat(1001) }), tooLong.response)
    expect(tooLong.status).toBe(400)
    expect(deliveries).toBe(0)
  })

  it('serves the notification artwork even when no session is presented', async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-web-push-icons-'))
    const store = PushStore.open(join(root, 'state.json'), () => ({ publicKey: 'AQID', privateKey: 'BAUG' }))
    const routes = createPushRoutes({
      store,
      sender: { send: vi.fn(async () => {}) },
      maxRequestBodyBytes: 1024,
      // The browser fetches a notification's icon itself, with no app cookie.
      requestRejection: () => 401,
    })
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    for (const path of [NOTIFICATION_ICON_PATH, NOTIFICATION_BADGE_PATH]) {
      const result = response()
      await find(path, routes).handler(request('GET'), result.response)
      expect(result.status, path).toBe(200)
      expect(Buffer.isBuffer(result.raw), path).toBe(true)
      expect((result.raw as Buffer).subarray(0, 8).equals(pngSignature), path).toBe(true)
      expect(result.headers['cache-control'], path).toBe('no-store')
    }
  })
})
