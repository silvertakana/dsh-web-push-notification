import { describe, expect, it } from 'vitest'
import { MAX_NOTIFICATION_BODY_BYTES, notificationForEvent, sessionTitleOf } from '../src/notification.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function event(value: unknown): SessionEvent {
  return value as SessionEvent
}

describe('notification projection', () => {
  it('uses the latest assistant text for full mode and a status for summary mode', () => {
    const assistant = event({
      type: 'assistant/message',
      seq: 1,
      time: 1,
      data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'The answer.' }] } },
    })
    const end = event({
      type: 'turn/end',
      seq: 2,
      time: 2,
      data: { turn: 1, reason: { kind: 'completed' } },
    })
    expect(notificationForEvent('session-1', end, { events: [assistant, end] })?.body).toBe('The answer.')
    expect(notificationForEvent('session-1', end, { bodyMode: 'summary', events: [assistant, end] })?.body).toBe(
      'Turn 1 completed.',
    )
  })

  it('includes question text and bounds UTF-8 content', () => {
    const question = event({
      type: 'tool/call',
      seq: 1,
      time: 1,
      data: {
        turn: 1,
        step: 1,
        callId: 'call-1',
        name: 'ask_user_question',
        arguments: JSON.stringify({ questions: [{ question: 'Continue?' }] }),
      },
    })
    expect(notificationForEvent('session-1', question)?.body).toBe('Continue?')
    const long = event({
      type: 'turn/end',
      seq: 2,
      time: 2,
      data: { turn: 1, reason: { kind: 'completed' } },
    })
    const longAssistant = event({
      type: 'assistant/message',
      seq: 1,
      time: 1,
      data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'あ'.repeat(2000) }] } },
    })
    const body = notificationForEvent('session-1', long, { events: [longAssistant, long] })?.body ?? ''
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(MAX_NOTIFICATION_BODY_BYTES)
    expect(body.endsWith('…')).toBe(true)
  })

  it('uses the approval reason only in full mode', () => {
    const approval = event({
      type: 'approval/asked',
      data: { id: 'approval-1', toolName: 'bash', reason: 'Allow this command?' },
    })
    expect(notificationForEvent('session-1', approval)?.body).toBe('Allow this command?')
    expect(notificationForEvent('session-1', approval, { bodyMode: 'summary' })?.body).toBe(
      'Approval is required for bash.',
    )
  })
})

describe('session title', () => {
  const titleEvent = (value: unknown): SessionEvent => event({ type: 'session/title', seq: 9, time: 9, data: value })

  it('folds the latest logged title and ignores unusable snapshots', () => {
    expect(sessionTitleOf([titleEvent({ title: 'First' }), titleEvent({ title: 'Latest' })])).toBe('Latest')
    expect(sessionTitleOf([titleEvent({ title: '  Padded  ' })])).toBe('Padded')
    expect(sessionTitleOf([titleEvent({ title: '   ' }), titleEvent({})])).toBeUndefined()
    expect(sessionTitleOf([titleEvent({ title: 7 })])).toBeUndefined()
    expect(sessionTitleOf([])).toBeUndefined()
  })

  it('names the session in the title and keeps the kind title as the fallback', () => {
    const end = event({ type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'completed' } } })
    expect(notificationForEvent('session-1', end)?.title).toBe('DeepSeek Harness: task completed')
    expect(notificationForEvent('session-1', end, { sessionTitle: 'Fix the paste bug' })?.title).toBe(
      'Fix the paste bug',
    )
    expect(notificationForEvent('session-1', end, { sessionTitle: '   ' })?.title).toBe(
      'DeepSeek Harness: task completed',
    )
  })

  it('names the session for every kind, not only completed turns', () => {
    const approval = event({ type: 'approval/asked', data: { id: 'a', toolName: 'bash', reason: 'Allow?' } })
    const question = event({
      type: 'tool/call',
      data: {
        callId: 'c',
        name: 'ask_user_question',
        arguments: JSON.stringify({ questions: [{ question: 'Continue?' }] }),
      },
    })
    for (const candidate of [approval, question]) {
      expect(notificationForEvent('session-1', candidate, { sessionTitle: 'Ship it' })?.title).toBe('Ship it')
    }
  })

  it('scopes the tag to its session so two sessions never collapse into one row', () => {
    const end = event({ type: 'turn/end', seq: 2, time: 2, data: { turn: 4, reason: { kind: 'completed' } } })
    expect(notificationForEvent('session-a', end)?.tag).toBe('dsh-web-push-session-a-turn-4-completed')
    expect(notificationForEvent('session-b', end)?.tag).not.toBe(notificationForEvent('session-a', end)?.tag)
  })
})
