import { describe, expect, test } from 'claude-code/testing'

import {
  GRAMMAR_COLOR,
  MAX_LENGTH,
  SPELLING_COLOR,
  buildCheckBody,
  maskText,
  parseResponse,
  shouldCheck,
  toDecorations,
} from './check'

describe('shouldCheck', () => {
  test('ignore le vide, les commandes slash, bash et mémoire', async () => {
    expect(shouldCheck('')).toBe(false)
    expect(shouldCheck('  ')).toBe(false)
    expect(shouldCheck('/help')).toBe(false)
    expect(shouldCheck('! ls -la')).toBe(false)
    expect(shouldCheck('# retenir ceci')).toBe(false)
    expect(shouldCheck('123 456')).toBe(false)
  })

  test('accepte une phrase de taille raisonnable', async () => {
    expect(shouldCheck('Bonjour le monde')).toBe(true)
    expect(shouldCheck('ok')).toBe(false)
    expect(shouldCheck('a'.repeat(MAX_LENGTH + 1))).toBe(false)
  })
})

describe('maskText', () => {
  test('masque le code en ligne en conservant la longueur', async () => {
    const text = 'corrige `enable_dc` stp'
    const masked = maskText(text)
    expect(masked.length).toBe(text.length)
    expect(masked).toBe('corrige ' + ' '.repeat(11) + ' stp')
  })

  test('masque un bloc de code en gardant les sauts de ligne', async () => {
    expect(maskText('a\n```\nfoo bar\n```\nb')).toBe('a\n   \n       \n   \nb')
  })

  test('masque URL, chemins, mentions et identifiants techniques', async () => {
    const text = 'voir https://x.io/a et /home/seb/x et @src/main.rs et i915 et serverState mais peut-être pas'
    const masked = maskText(text)
    expect(masked.length).toBe(text.length)
    expect(masked.includes('seb')).toBe(false)
    expect(masked.includes('x.io')).toBe(false)
    expect(masked.includes('main.rs')).toBe(false)
    expect(masked.includes('i915')).toBe(false)
    expect(masked.includes('serverState')).toBe(false)
    expect(masked.includes('voir')).toBe(true)
    expect(masked.includes('peut-être pas')).toBe(true)
  })
})

describe('toDecorations', () => {
  const spelling = {
    offset: 3,
    length: 4,
    rule: { id: 'FR_SPELLING_RULE', issueType: 'misspelling', category: { id: 'TYPOS' } },
  }
  const grammar = {
    offset: 10,
    length: 9,
    rule: { id: 'D_N', issueType: 'uncategorized', category: { id: 'AGREEMENT' } },
  }

  test('rouge pour l’orthographe, bleu pour la grammaire', async () => {
    expect(toDecorations([spelling, grammar], 40)).toEqual([
      { start: 3, end: 7, underline: true, color: SPELLING_COLOR },
      { start: 10, end: 19, underline: true, color: GRAMMAR_COLOR },
    ])
  })

  test('ignore les règles bruyantes et les plages hors texte', async () => {
    const point = { offset: 0, length: 1, rule: { id: 'POINT', issueType: 'uncategorized' } }
    const casing = { offset: 0, length: 3, rule: { id: 'UPPERCASE_SENTENCE_START', issueType: 'typographical' } }
    const beyond = { offset: 38, length: 5, rule: { id: 'D_N' } }
    const empty = { offset: 5, length: 0, rule: { id: 'D_N' } }
    expect(toDecorations([point, casing, beyond, empty], 40)).toEqual([])
    expect(toDecorations(undefined, 40)).toEqual([])
  })
})

describe('requête et réponse LanguageTool', () => {
  test('le corps encode le texte avec détection automatique de langue', async () => {
    const body = buildCheckBody('lé fote')
    expect(body.includes('text=l%C3%A9+fote')).toBe(true)
    expect(body.includes('language=auto')).toBe(true)
  })

  test('une réponse invalide donne un résultat vide', async () => {
    expect(parseResponse('pas du json')).toEqual({})
    expect(parseResponse('{"matches":[]}')).toEqual({ matches: [] })
  })
})
