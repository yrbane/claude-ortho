// Mod « ortho » : souligne pendant la frappe les fautes d'orthographe (rouge) et de grammaire (bleu)
// dans la zone de saisie, grâce à un serveur LanguageTool local lancé à la demande.
import type { EngineInterface, HttpResponse, Register, Timer } from 'claude-code'

import {
  type Correction,
  applyCorrection,
  buildCheckBody,
  maskText,
  parseApplyToken,
  parseListenerPid,
  parseResponse,
  shouldCheck,
  toCorrections,
  toDecorations,
} from './check'
import { createDiagnostics, formatDiagnostics } from './diagnostics'

const PORT = 8099
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEBOUNCE_MS = 450
const PROBE_EVERY_MS = 1000
const PROBE_GIVE_UP_MS = 90_000
const RETRY_AFTER_FAILURE_MS = 30_000
// Au-delà, un serveur qui a accepté la connexion sans répondre est tenu pour gelé
const PROBE_TIMEOUT_MS = 5000
const CHECK_TIMEOUT_MS = 10_000

type ServerState = 'unknown' | 'starting' | 'ready' | 'failed'
// Ce que dit la sonde : le serveur répond, rien n'écoute, ou quelque chose écoute sans répondre
type Probe = 'up' | 'down' | 'silent'

// État du module, remis à zéro à chaque rechargement (ce qui relance la sonde du serveur)
const server: { state: ServerState } = { state: 'unknown' }
let pending: Timer | undefined
let lastDraft = ''
// Les correspondances du dernier brouillon vérifié : ce qu'un jeton de rustty vise
let corrections: Correction[] = []
const diag = createDiagnostics()

// `$.http.fetch` n'a pas de délai maximal : la requête est mise en course avec l'horloge,
// sans quoi un serveur gelé (session Claude suspendue par Ctrl+Z) suspendrait le mod avec lui
async function fetchWithin(
  $: EngineInterface,
  url: string,
  ms: number,
  init?: Parameters<EngineInterface['http']['fetch']>[1],
): Promise<HttpResponse | 'silent'> {
  let deadline: Timer | undefined
  const silence = new Promise<'silent'>(resolve => {
    deadline = $.clock.after(ms, () => resolve('silent'))
  })
  try {
    return await Promise.race([$.http.fetch(url, init), silence])
  } finally {
    deadline?.cancel()
  }
}

async function probe($: EngineInterface): Promise<Probe> {
  try {
    const response = await fetchWithin($, `${BASE_URL}/v2/languages`, PROBE_TIMEOUT_MS)
    if (response === 'silent') {
      diag.lastError = `sonde : aucune réponse en ${PROBE_TIMEOUT_MS / 1000} s`
      return 'silent'
    }
    return response.ok ? 'up' : 'down'
  } catch (error) {
    diag.lastError = `sonde : ${String(error)}`
    return 'down'
  }
}

// Qui tient le port : via `ss` quand il existe (Linux), sinon on ne sait pas
async function listenerPid($: EngineInterface): Promise<number | null> {
  try {
    const result = await $.process.run(['ss', '-ltnpH', `sport = :${PORT}`], { timeoutMs: 3000 })
    return parseListenerPid(result.stdout)
  } catch {
    return null
  }
}

function markFailed($: EngineInterface, reason: string): void {
  server.state = 'failed'
  $.ui.status(undefined)
  $.ui.toast(`ortho : ${reason}, nouvel essai dans ${RETRY_AFTER_FAILURE_MS / 1000} s`)
  $.clock.after(RETRY_AFTER_FAILURE_MS, () => {
    server.state = 'unknown'
  })
}

// Le port est pris par un serveur qui ne répond pas : inutile d'en lancer un autre, on nomme le coupable
async function markSilent($: EngineInterface): Promise<void> {
  const pid = await listenerPid($)
  const holder = pid === null ? 'un serveur' : `le processus ${pid}`
  const reason = `${holder} occupe le port ${PORT} sans répondre`
  diag.lastError = `${reason} (session Claude suspendue par Ctrl+Z ? le tuer libère le port)`
  markFailed($, reason)
}

// Le processus enfant s'est terminé : échec, sauf s'il a déjà été constaté
function onChildExit($: EngineInterface): void {
  if (server.state !== 'failed') markFailed($, 'LanguageTool indisponible')
}

// Lance LanguageTool pour la vie du module. Sa sortie part dans /dev/null : branchée sur
// Claude, elle bloquerait la JVM dès que la session cesse de la lire (Ctrl+Z) ; la
// disponibilité se sonde sur le port.
async function runChild($: EngineInterface): Promise<void> {
  const child = $.process.spawn({
    argv: ['sh', '-c', 'exec languagetool --http --port "$1" >/dev/null 2>&1', 'ortho', String(PORT)],
  })
  try {
    for await (const _chunk of child) {
      // rien à lire
    }
  } catch {
    // le processus n'a pas pu démarrer : traité comme une fin de processus
  }
  onChildExit($)
}

async function probeOnce($: EngineInterface, startedAt: number, timer: Timer): Promise<void> {
  if (server.state !== 'starting') {
    timer.cancel()
    return
  }
  const result = await probe($)
  if (result === 'up') {
    timer.cancel()
    server.state = 'ready'
    $.ui.status(undefined)
    void check($, lastDraft)
    return
  }
  if (result === 'silent') {
    timer.cancel()
    await markSilent($)
    return
  }
  if ((await $.clock.now()) - startedAt > PROBE_GIVE_UP_MS) {
    timer.cancel()
    markFailed($, 'LanguageTool indisponible')
  }
}

// Réutilise un serveur déjà lancé (autre session Claude) ou en démarre un
async function ensureServer($: EngineInterface): Promise<void> {
  if (server.state !== 'unknown') return
  server.state = 'starting'
  const result = await probe($)
  if (result === 'up') {
    server.state = 'ready'
    return
  }
  if (result === 'silent') {
    await markSilent($)
    return
  }
  $.ui.status('ortho : démarrage de LanguageTool…')
  void runChild($)
  const startedAt = await $.clock.now()
  const timer: Timer = $.clock.every(PROBE_EVERY_MS, () => {
    void probeOnce($, startedAt, timer)
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
    response = await fetchWithin($, `${BASE_URL}/v2/check`, CHECK_TIMEOUT_MS, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: buildCheckBody(maskText(text)),
    })
  } catch (error) {
    diag.lastError = `fetch : ${String(error)}`
    server.state = 'unknown'
    return
  }
  if (response === 'silent') {
    // Le serveur s'est figé en cours de route : la prochaine vérification le sondera
    diag.lastError = `vérification : aucune réponse en ${CHECK_TIMEOUT_MS / 1000} s`
    server.state = 'unknown'
    return
  }
  diag.lastFetch = `HTTP ${response.status}`
  if (!response.ok) return
  const matches = parseResponse(response.text).matches
  const decorations = toDecorations(matches, text.length)
  corrections = toCorrections(matches, text)
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

  // La frappe passe par prompt.edit ; historique, effacement et remplissage par prompt.change.
  // Un jeton collé par rustty (clic sur une suggestion de son infobulle) est consommé ici :
  // il remplace le mot visé dans le brouillon et ne laisse rien derrière lui.
  on('prompt.edit', async ($, e, next) => {
    const token = parseApplyToken(e.inputText)
    if (token) {
      const box = applyCorrection(e.text, e.cursor, corrections, token) ?? { text: e.text, cursor: e.cursor }
      schedule($, box.text)
      return box
    }
    const result = await next(e)
    schedule($, result.text)
    return result
  })

  on('prompt.change', ($, e, next) => {
    schedule($, e.text)
    return next(e)
  })
}
