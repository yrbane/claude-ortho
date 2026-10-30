import type { PromptEditInput, PromptEditResult } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const LT_RESPONSE = JSON.stringify({
  matches: [
    {
      offset: 3,
      length: 4,
      rule: { id: 'FR_SPELLING_RULE', issueType: 'misspelling', category: { id: 'TYPOS' } },
    },
  ],
})

test('une pause de frappe peint les fautes du brouillon', async ($, on) => {
  const clock = mock.clock(on)
  const painted: unknown[] = []
  const fetched: string[] = []

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'ortho' } }))
  on('http.fetch', (_, e) => {
    fetched.push(e.url)
    const text = e.url.endsWith('/v2/check') ? LT_RESPONSE : '[]'
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  on('prompt.read', () => ({ value: { text: 'lé fote ici', cursor: 11 } }))
  on('prompt.paint', (_, e) => {
    painted.push(e)
    const text = e.text ?? ''
    return { value: { isPainted: true, text, cursor: text.length } }
  })
  on('prompt.edit', (_, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // Le kit lève prompt.edit à l'exécution mais ses typages ne le déclarent pas encore
  const prompt = $.prompt as unknown as { edit: (e: PromptEditInput) => Promise<PromptEditResult> }
  await prompt.edit({
    origin: { kind: 'composer' },
    text: '',
    cursor: 0,
    start: 0,
    end: 0,
    inputText: 'lé fote ici',
  })
  for (let i = 0; i < 20 && painted.length === 0; i++) await clock.advance(100)

  expect(fetched.some(url => url.endsWith('/v2/check'))).toBe(true)
  expect(painted).toEqual([
    {
      text: 'lé fote ici',
      decorations: [{ start: 3, end: 7, underline: true, color: 'red' }],
    },
  ])
})
