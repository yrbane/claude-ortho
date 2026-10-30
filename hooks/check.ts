// Logique pure du correcteur : filtrage du brouillon, masquage de ce qui n'est pas de la prose,
// et conversion des correspondances LanguageTool en décorations de la zone de saisie.
import type { PromptDecoration } from 'claude-code'

export type LtMatch = {
  offset: number
  length: number
  rule: { id: string; issueType?: string; category?: { id?: string } }
}

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

function isSpelling(match: LtMatch): boolean {
  return match.rule.issueType === 'misspelling' || match.rule.category?.id === 'TYPOS'
}

export function toDecorations(
  matches: readonly LtMatch[] | undefined,
  textLength: number,
): PromptDecoration[] {
  const decorations: PromptDecoration[] = []
  for (const match of matches ?? []) {
    if (IGNORED_RULES.has(match.rule.id)) continue
    const start = match.offset
    const end = match.offset + match.length
    if (start < 0 || end > textLength || end <= start) continue
    decorations.push({
      start,
      end,
      underline: true,
      color: isSpelling(match) ? SPELLING_COLOR : GRAMMAR_COLOR,
    })
  }
  return decorations
}
