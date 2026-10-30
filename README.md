# ortho — correcteur orthographique et grammatical pour la saisie Claude Code

Mod Claude Code qui souligne, pendant la frappe, les fautes dans la zone de saisie du terminal :

- **rouge** : orthographe (mot inconnu, coquille) ;
- **bleu** : grammaire, accords, homonymes, typographie.

Purement visuel : le texte n'est jamais modifié et rien n'est ajouté au message envoyé à Claude.

## Fonctionnement

1. À l'ouverture de la session, le mod cherche un serveur [LanguageTool](https://languagetool.org) sur `127.0.0.1:8099`. S'il n'y en a pas, il en lance un (`languagetool --http --port 8099`) qui vit le temps de la session.
2. À chaque changement du brouillon, après 450 ms sans frappe, le texte est envoyé au serveur local (`/v2/check`, langue détectée automatiquement, variante anglaise `en-US`).
3. Les correspondances sont converties en soulignés colorés via `$.prompt.paint`, après une lecture de la boîte par `$.prompt.read` : sans cette lecture, le moteur répond `isPainted: false` et ne dessine rien (piège rencontré en 0.1.0).

Ne sont pas corrigés : commandes `/`, `!` et notes `#`, blocs et code en ligne, URL, chemins, mentions `@fichier`, identifiants `snake_case`, `camelCase` et mélanges lettres/chiffres. Les règles « majuscule en début de phrase » et « point final » sont ignorées, trop bruyantes dans un chat.

## Corrections au survol, avec rustty

Le moteur de Claude Code ne transmet aucun événement de souris sur la zone de saisie à un mod : le survol vient donc du terminal. Dans [rustty](https://github.com/yrbane/rustty) (à partir de 0.1.0-alpha.134), poser la souris sur un mot souligné ouvre une infobulle avec le message de LanguageTool et ses suggestions ; un clic sur l'une d'elles la colle dans le terminal sous forme d'un jeton (`U+E000 ortho U+E001 mot U+E001 remplacement U+E001 rang U+E002`) que ce mod consomme dans `prompt.edit` : le mot visé est remplacé dans le brouillon, le curseur replacé, et rien du jeton ne reste. Le rang distingue les occurrences d'un même mot fautif. Contrat détaillé dans la spec de rustty, `docs/superpowers/specs/2026-10-30-spell-popup-design.md`.

Dans un autre terminal, rien ne change : les soulignés restent purement visuels.

## Commande `/ortho`

Affiche l'état interne du correcteur : état du serveur LanguageTool, nombre d'éditions vues, dernière requête, dernière peinture, dernière erreur. C'est le premier réflexe quand rien ne se souligne.

## Installation

```
git clone git@github.com:yrbane/claude-ortho.git ~/Dev/claude-ortho
claude --plugin-dir ~/Dev/claude-ortho
```

Pour le charger à chaque session, déclarer le dossier dans le bloc `env` de `~/.claude/settings.json` :

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/home/<vous>/Dev/claude-ortho" } }
```

## Prérequis

- Arch Linux : `sudo pacman -S --needed languagetool` (Java déjà présent via `java-runtime-headless`).
- Rien ne sort de la machine : le serveur écoute en local uniquement.

## Développement

```
claude plugin validate <dossier du mod>
claude plugin test <dossier du mod>
```

Les tests couvrent la logique pure (`hooks/check.test.ts`, `hooks/diagnostics.test.ts`) et la chaîne complète frappe → anti-rebond → LanguageTool → peinture (`hooks/register.test.ts`, avec horloge et réseau simulés par le kit `claude-code/testing`).

Structure : `hooks/register.ts` ne fait que brancher les événements ; `hooks/check.ts` porte la logique métier sans dépendance au moteur (filtrage, masquage, décorations, corrections et jeton rustty) ; `hooks/diagnostics.ts` le rapport de `/ortho`.
