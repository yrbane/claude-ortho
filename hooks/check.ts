// Logique pure du correcteur : filtrage du brouillon, masquage de ce qui n'est pas de la prose,
// et conversion des correspondances LanguageTool en décorations de la zone de saisie.
import type { PromptDecoration } from 'claude-code'

export type LtMatch = {
  offset: number
  length: number
  rule: { id: string; issueType?: string; category?: { id?: string } }
  message?: string
  replacements?: { value: string }[]
}

// Une correspondance retenue, avec le mot fautif et ce que LanguageTool propose à la place
export type Correction = { start: number; end: number; word: string; replacements: string[] }

// Ce que rustty envoie quand une suggestion est cliquée dans son infobulle
export type ApplyToken = { word: string; replacement: string; occurrence: number }

// Jeton : U+E000 "ortho" U+E001 mot U+E001 remplacement U+E001 rang U+E002
// (contrat décrit dans rustty, docs/superpowers/specs/2026-10-30-spell-popup-design.md)
const APPLY_TOKEN = /^\uE000ortho\uE001([^\uE000-\uE002]*)\uE001([^\uE000-\uE002]*)\uE001(\d+)\uE002$/u

export type LtResponse = { matches?: LtMatch[] }

export const SPELLING_COLOR = 'red'
export const GRAMMAR_COLOR = 'blue'
export const MAX_LENGTH = 20_000

// Règles trop bruyantes dans une zone de chat : majuscule initiale, point final, espaces doublés par le masquage
const IGNORED_RULES: ReadonlySet<string> = new Set([
  'WHITESPACE_RULE',
  'UPPERCASE_SENTENCE_START',
  'POINT',
  'PUNCTUATION_PARAGRAPH_END',
])

// Ce qui n'est pas de la prose : blocs et code en ligne, URL, chemins, mentions @fichier,
// identifiants snake_case, camelCase et mélanges lettres/chiffres (i915, R6020)
const MASKED_PATTERNS: readonly RegExp[] = [
  /```[\s\S]*?(?:```|$)/g,
  /`[^`\n]*`/g,
  /https?:\/\/\S+/g,
  /(?<!\S)[~.]?\/[^\s`'"]+/g,
  /(?<!\S)@\S+/g,
  /(?<![\p{L}\p{N}])[\p{L}\p{N}]*_[\p{L}\p{N}_]*(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])\p{Ll}+\p{Lu}[\p{L}\p{N}]*(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])(?=[\p{L}\p{N}]*\p{N})(?=[\p{L}\p{N}]*\p{L})[\p{L}\p{N}]+(?![\p{L}\p{N}])/gu,
]

// Un brouillon vaut une vérification s'il contient de la prose et n'est ni une commande ni une note mémoire
export function shouldCheck(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 3 || trimmed.length > MAX_LENGTH) return false
  if (/^[/!#]/.test(trimmed)) return false
  return /\p{L}{2,}/u.test(trimmed)
}

// Remplace par des espaces (même longueur, sauts de ligne conservés) tout ce qu'il ne faut pas corriger,
// pour que les offsets renvoyés par LanguageTool restent ceux du texte d'origine
export function maskText(text: string): string {
  return MASKED_PATTERNS.reduce(
    (out, pattern) => out.replace(pattern, match => match.replace(/[^\n]/g, ' ')),
    text,
  )
}

export function buildCheckBody(text: string): string {
  return new URLSearchParams({ text, language: 'auto', preferredVariants: 'en-US' }).toString()
}

export function parseResponse(json: string): LtResponse {
  try {
    return JSON.parse(json) as LtResponse
  } catch {
    return {}
  }
}

// Les correspondances retenues pour la peinture, dans l'ordre de LanguageTool
function retained(matches: readonly LtMatch[] | undefined, textLength: number): LtMatch[] {
  return (matches ?? []).filter(match => {
    if (IGNORED_RULES.has(match.rule.id)) return false
    const end = match.offset + match.length
    return match.offset >= 0 && end <= textLength && end > match.offset
  })
}

function isSpelling(match: LtMatch): boolean {
  return match.rule.issueType === 'misspelling' || match.rule.category?.id === 'TYPOS'
}

export function toDecorations(
  matches: readonly LtMatch[] | undefined,
  textLength: number,
): PromptDecoration[] {
  return retained(matches, textLength).map(match => ({
    start: match.offset,
    end: match.offset + match.length,
    underline: true,
    color: isSpelling(match) ? SPELLING_COLOR : GRAMMAR_COLOR,
  }))
}

export function toCorrections(matches: readonly LtMatch[] | undefined, text: string): Correction[] {
  return retained(matches, text.length).map(match => ({
    start: match.offset,
    end: match.offset + match.length,
    word: text.slice(match.offset, match.offset + match.length),
    replacements: (match.replacements ?? []).map(r => r.value).filter(v => v.length > 0),
  }))
}

export function parseApplyToken(input: string): ApplyToken | null {
  const found = APPLY_TOKEN.exec(input)
  if (!found) return null
  return { word: found[1] ?? '', replacement: found[2] ?? '', occurrence: Number(found[3]) }
}

// La n-ième occurrence du mot dans le texte, mot entier, quand la liste des corrections est périmée
function nthOccurrence(text: string, word: string, n: number): { start: number; end: number } | null {
  if (word.length === 0) return null
  let from = 0
  let seen = 0
  for (;;) {
    const start = text.indexOf(word, from)
    if (start < 0) return null
    const end = start + word.length
    const whole = !/[\p{L}\p{N}]$/u.test(text.slice(0, start)) && !/^[\p{L}\p{N}]/u.test(text.slice(end))
    if (whole && seen++ === n) return { start, end }
    from = start + 1
  }
}

// Applique le remplacement demandé par le jeton : d'abord sur la correspondance visée,
// sinon sur l'occurrence du mot dans le texte ; null si rien ne correspond
export function applyCorrection(
  text: string,
  cursor: number,
  corrections: readonly Correction[],
  token: ApplyToken,
): { text: string; cursor: number } | null {
  const target =
    corrections.filter(c => c.word === token.word)[token.occurrence] ??
    nthOccurrence(text, token.word, token.occurrence)
  if (!target) return null
  const replaced = text.slice(0, target.start) + token.replacement + text.slice(target.end)
  let moved = cursor
  if (cursor >= target.end) moved = cursor + token.replacement.length - (target.end - target.start)
  else if (cursor > target.start) moved = target.start + token.replacement.length
  return { text: replaced, cursor: moved }
}
