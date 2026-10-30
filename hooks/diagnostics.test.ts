import { expect, test } from 'claude-code/testing'

import { createDiagnostics, formatDiagnostics } from './diagnostics'

test('le diagnostic liste l’état du serveur et les compteurs', async () => {
  const diag = createDiagnostics()
  diag.edits = 3
  diag.lastFetch = 'HTTP 200'
  const text = formatDiagnostics('ready', diag)
  expect(text.includes('serveur LanguageTool : ready')).toBe(true)
  expect(text.includes('éditions vues : 3')).toBe(true)
  expect(text.includes('dernière requête : HTTP 200')).toBe(true)
  expect(text.includes('dernière erreur : —')).toBe(true)
})
