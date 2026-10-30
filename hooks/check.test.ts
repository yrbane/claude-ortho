import { describe, expect, test } from 'claude-code/testing'

import {
  GRAMMAR_COLOR,
  MAX_LENGTH,
  SPELLING_COLOR,
  applyCorrection,
  buildCheckBody,
  maskText,
  parseApplyToken,
  parseResponse,
  shouldCheck,
  toCorrections,
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

describe('toCorrections', () => {
  test('garde le mot et les remplacements de chaque correspondance retenue', async () => {
    const text = 'yo cé coule ma poulle'
    const matches = [
      { offset: 15, length: 6, rule: { id: 'FR_SPELLING_RULE' }, replacements: [{ value: 'poule' }, { value: 'poulie' }] },
      { offset: 0, length: 2, rule: { id: 'UPPERCASE_SENTENCE_START' }, replacements: [{ value: 'Yo' }] },
      { offset: 3, length: 2, rule: { id: 'X' } },
    ]
    expect(toCorrections(matches, text)).toEqual([
      { start: 15, end: 21, word: 'poulle', replacements: ['poule', 'poulie'] },
      { start: 3, end: 5, word: 'cé', replacements: [] },
    ])
  })
})

describe('parseApplyToken', () => {
  test('lit le jeton envoyé par rustty et rien d\'autre', async () => {
    expect(parseApplyToken('\uE000ortho\uE001poulle\uE001poule\uE0011\uE002')).toEqual({
      word: 'poulle',
      replacement: 'poule',
      occurrence: 1,
    })
    expect(parseApplyToken('poulle')).toBe(null)
    expect(parseApplyToken('\uE000ortho\uE001a\uE001b\uE002')).toBe(null)
    expect(parseApplyToken('x\uE000ortho\uE001a\uE001b\uE0010\uE002')).toBe(null)
  })
})

describe('applyCorrection', () => {
  const corrections = [
    { start: 3, end: 9, word: 'poulle', replacements: ['poule'] },
    { start: 13, end: 19, word: 'poulle', replacements: ['poule'] },
  ]

  test('remplace l\'occurrence visée et déplace le curseur situé après', async () => {
    const text = 'ma poulle et poulle là'
    expect(applyCorrection(text, 22, corrections, { word: 'poulle', replacement: 'poule', occurrence: 1 })).toEqual({
      text: 'ma poulle et poule là',
      cursor: 21,
    })
    expect(applyCorrection(text, 5, corrections, { word: 'poulle', replacement: 'poule', occurrence: 0 })).toEqual({
      text: 'ma poule et poulle là',
      cursor: 8,
    })
    expect(applyCorrection(text, 1, corrections, { word: 'poulle', replacement: 'poule', occurrence: 0 })?.cursor).toBe(1)
  })

  test('retombe sur le texte quand la liste des corrections est périmée', async () => {
    const text = 'ma poulle et poulle là'
    expect(applyCorrection(text, 0, [], { word: 'poulle', replacement: 'poule', occurrence: 1 })?.text).toBe(
      'ma poulle et poule là',
    )
    expect(applyCorrection(text, 0, [], { word: 'absent', replacement: 'x', occurrence: 0 })).toBe(null)
    expect(applyCorrection(text, 0, [], { word: 'poulle', replacement: 'x', occurrence: 5 })).toBe(null)
  })
})
