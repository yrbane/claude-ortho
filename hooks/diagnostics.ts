// Diagnostic du mod : compteurs et derniers résultats, exposés par la commande /ortho
export type Diagnostics = {
  edits: number
  checks: number
  lastFetch: string
  lastPaint: string
  lastError: string
}

export function createDiagnostics(): Diagnostics {
  return { edits: 0, checks: 0, lastFetch: '—', lastPaint: '—', lastError: '—' }
}

export function formatDiagnostics(serverState: string, diag: Diagnostics): string {
  return [
    `ortho — serveur LanguageTool : ${serverState}`,
    `éditions vues : ${diag.edits}`,
    `vérifications lancées : ${diag.checks}`,
    `dernière requête : ${diag.lastFetch}`,
    `dernière peinture : ${diag.lastPaint}`,
    `dernière erreur : ${diag.lastError}`,
  ].join('\n')
}
