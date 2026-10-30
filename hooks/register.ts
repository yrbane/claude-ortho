// Mod « ortho » : souligne pendant la frappe les fautes d'orthographe (rouge) et de grammaire (bleu)
// dans la zone de saisie, grâce à un serveur LanguageTool local lancé à la demande.
import type { EngineInterface, Register, Timer } from 'claude-code'

import { buildCheckBody, maskText, parseResponse, shouldCheck, toDecorations } from './check'
import { createDiagnostics, formatDiagnostics } from './diagnostics'

const PORT = 8099
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEBOUNCE_MS = 450
const PROBE_EVERY_MS = 1000
const PROBE_GIVE_UP_MS = 90_000
const RETRY_AFTER_FAILURE_MS = 30_000

type ServerState = 'unknown' | 'starting' | 'ready' | 'failed'

// État du module, remis à zéro à chaque rechargement (ce qui relance la sonde du serveur)
const server: { state: ServerState } = { state: 'unknown' }
let pending: Timer | undefined
let lastDraft = ''
const diag = createDiagnostics()

async function isUp($: EngineInterface): Promise<boolean> {
  try {
    return (await $.http.fetch(`${BASE_URL}/v2/languages`)).ok
  } catch (error) {
    diag.lastError = `sonde : ${String(error)}`
    return false
  }
}

function markFailed($: EngineInterface): void {
  server.state = 'failed'
  $.ui.status(undefined)
  $.ui.toast('ortho : LanguageTool indisponible, nouvel essai dans 30 s')
  $.clock.after(RETRY_AFTER_FAILURE_MS, () => {
    server.state = 'unknown'
  })
}

// Le processus enfant s'est terminé : échec, sauf s'il a déjà été constaté
function onChildExit($: EngineInterface): void {
  if (server.state !== 'failed') markFailed($)
}

// Lance LanguageTool pour la vie du module ; la sortie n'importe pas, la disponibilité se sonde sur le port
async function runChild($: EngineInterface): Promise<void> {
  const child = $.process.spawn({ argv: ['languagetool', '--http', '--port', String(PORT)] })
  try {
    for await (const _chunk of child) {
      // rien à lire
    }
  } catch {
    // le processus n'a pas pu démarrer : traité comme une fin de processus
  }
  onChildExit($)
}

async function probeOnce($: EngineInterface, startedAt: number, probe: Timer): Promise<void> {
  if (server.state !== 'starting') {
    probe.cancel()
    return
  }
  if (await isUp($)) {
    probe.cancel()
    server.state = 'ready'
    $.ui.status(undefined)
    void check($, lastDraft)
    return
  }
  if ((await $.clock.now()) - startedAt > PROBE_GIVE_UP_MS) {
    probe.cancel()
    markFailed($)
  }
}

// Réutilise un serveur déjà lancé (autre session Claude) ou en démarre un
async function ensureServer($: EngineInterface): Promise<void> {
  if (server.state !== 'unknown') return
  server.state = 'starting'
  if (await isUp($)) {
    server.state = 'ready'
    return
  }
  $.ui.status('ortho : démarrage de LanguageTool…')
  void runChild($)
  const startedAt = await $.clock.now()
  const probe: Timer = $.clock.every(PROBE_EVERY_MS, () => {
    void probeOnce($, startedAt, probe)
  })
}

// Interroge LanguageTool et peint les soulignés ; le moteur ignore la peinture
// si le brouillon a changé entre-temps, donc aucune course à gérer ici
async function check($: EngineInterface, text: string): Promise<void> {
  if (!shouldCheck(text)) return
  if (server.state !== 'ready') {
    void ensureServer($)
    return
  }
  diag.checks += 1
  let response
  try {
    response = await $.http.fetch(`${BASE_URL}/v2/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: buildCheckBody(maskText(text)),
    })
  } catch (error) {
    diag.lastError = `fetch : ${String(error)}`
    server.state = 'unknown'
    return
  }
  diag.lastFetch = `HTTP ${response.status}`
  if (!response.ok) return
  const decorations = toDecorations(parseResponse(response.text).matches, text.length)
  try {
    // Lire la boîte avant de peindre est indispensable : le moteur n'applique la peinture
    // qu'à un module qui lit le brouillon (sans cet appel, isPainted reste false)
    const box = await $.prompt.read()
    const painted = await $.prompt.paint({ text, decorations })
    diag.lastPaint = [
      `${decorations.length} décoration(s)`,
      `isPainted=${String(painted.isPainted)}`,
      `boîte lue=${box.text === text ? 'identique' : `différente (${box.text.length} vs ${text.length})`}`,
      `boîte rendue=${painted.text.length} car.`,
    ].join(', ')
    // Le brouillon a bougé pendant la requête : on recalcule sur ce qu'il contient vraiment
    if (!painted.isPainted && box.text !== text && shouldCheck(box.text)) schedule($, box.text)
  } catch (error) {
    diag.lastError = `paint : ${String(error)}`
  }
}

// Anti-rebond : une vérification par pause de frappe
function schedule($: EngineInterface, text: string): void {
  diag.edits += 1
  lastDraft = text
  pending?.cancel()
  pending = undefined
  if (shouldCheck(text)) {
    pending = $.clock.after(DEBOUNCE_MS, () => {
      void check($, text)
    })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'ortho', description: 'État du correcteur ortho (LanguageTool)' })
    if (e.isInteractive) void ensureServer($)
    return started
  })

  on('command.run', { command: 'ortho' }, () => ({ text: formatDiagnostics(server.state, diag) }))

  // La frappe passe par prompt.edit ; historique, effacement et remplissage par prompt.change
  on('prompt.edit', async ($, e, next) => {
    const result = await next(e)
    schedule($, result.text)
    return result
  })

  on('prompt.change', ($, e, next) => {
    schedule($, e.text)
    return next(e)
  })
}
