import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEST_MESSAGE,
  validateEndpoint,
  validateStoreState,
  validateSubscription,
  validateTestMessage,
} from '../src/validation.ts'

const subscription = {
  endpoint: 'https://push.example.test/send/one',
  expirationTime: null,
  keys: { p256dh: 'AQID', auth: 'BAUG' },
  preferences: { turnCompleted: true, turnFailed: true, approval: true, question: true, bodyMode: 'full' as const },
}

describe('subscription validation', () => {
  it('accepts a browser subscription and normalizes missing expiration time', () => {
    expect(validateSubscription({ endpoint: subscription.endpoint, keys: subscription.keys })).toEqual(subscription)
    expect(validateEndpoint(subscription)).toBe(subscription.endpoint)
  })

  it('accepts the legacy preference record with the default full body mode', () => {
    const value = validateSubscription({
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      preferences: { turnCompleted: true, turnFailed: true, approval: true, question: true },
    })
    expect(value.preferences.bodyMode).toBe('full')
  })

  it('rejects insecure endpoints and padded keys', () => {
    expect(() => validateSubscription({ ...subscription, endpoint: 'http://push.example.test/send/one' })).toThrow(
      /HTTPS/,
    )
    expect(() => validateSubscription({ ...subscription, keys: { ...subscription.keys, auth: 'BAUG=' } })).toThrow(
      /auth/,
    )
  })

  it('rejects malformed persisted state and duplicate endpoints', () => {
    expect(() =>
      validateStoreState({
        version: 1,
        vapid: { publicKey: 'AQID', privateKey: 'BAUG' },
        subscriptions: [subscription, subscription],
      }),
    ).toThrow(/duplicate/)
  })

  it('rejects an endpoint that aims the sender at a private, loopback, or link-local host', () => {
    const rejected = [
      'https://localhost/send/one',
      'https://127.0.0.1/send/one',
      'https://10.1.2.3/send/one',
      'https://172.16.0.9/send/one',
      'https://172.31.255.1/send/one',
      'https://192.168.68.69/send/one',
      'https://169.254.169.254/send/one',
      'https://[::1]/send/one',
      'https://[fd00::1]/send/one',
      'https://printer.local/send/one',
    ]
    for (const endpoint of rejected) {
      expect(() => validateSubscription({ ...subscription, endpoint }), endpoint).toThrow(/private, loopback/)
    }
  })

  it('keeps accepting every real Push service and the public edge of each blocked range', () => {
    const accepted = [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QAbc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      // 172.32 sits just past the end of the 172.16/12 private block.
      'https://172.32.0.1/send/one',
      // A hostname may contain "localhost" without being localhost.
      'https://notlocalhost.example.test/send/one',
    ]
    for (const endpoint of accepted) {
      expect(validateEndpoint({ endpoint }), endpoint).toBe(endpoint)
    }
  })
})

describe('test notification copy', () => {
  it('falls back to the original copy when the caller sends nothing', () => {
    expect(validateTestMessage(undefined)).toEqual(DEFAULT_TEST_MESSAGE)
    expect(validateTestMessage({})).toEqual(DEFAULT_TEST_MESSAGE)
  })

  it('passes caller-supplied copy through unchanged, newlines included', () => {
    expect(validateTestMessage({ title: 'Build finished', body: 'line one\nline two' })).toEqual({
      title: 'Build finished',
      body: 'line one\nline two',
    })
  })

  it('honours an explicit empty string so a title-only notification can be previewed', () => {
    expect(validateTestMessage({ body: '' })).toEqual({ title: DEFAULT_TEST_MESSAGE.title, body: '' })
  })

  it('rejects non-string, over-long, and non-object copy', () => {
    expect(() => validateTestMessage({ title: 42 })).toThrow(/title must be a string/)
    expect(() => validateTestMessage({ body: 'x'.repeat(1001) })).toThrow(/at most 1000 characters/)
    expect(() => validateTestMessage({ title: 'x'.repeat(121) })).toThrow(/at most 120 characters/)
    expect(() => validateTestMessage('DeepSeek Harness')).toThrow(/must be an object/)
    expect(() => validateTestMessage(['title'])).toThrow(/must be an object/)
  })
})
