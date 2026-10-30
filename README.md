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

Structure : `hooks/register.ts` ne fait que brancher les événements ; `hooks/check.ts` porte la logique métier sans dépendance au moteur ; `hooks/diagnostics.ts` le rapport de `/ortho`.
