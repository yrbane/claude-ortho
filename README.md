# ortho — correcteur orthographique et grammatical pour la saisie Claude Code

Mod Claude Code qui souligne, pendant la frappe, les fautes dans la zone de saisie du terminal :

- **rouge** : orthographe (mot inconnu, coquille) ;
- **bleu** : grammaire, accords, homonymes, typographie.

Purement visuel : le texte n'est jamais modifié et rien n'est ajouté au message envoyé à Claude.

## Fonctionnement

1. À l'ouverture de la session, le mod sonde un serveur [LanguageTool](https://languagetool.org) sur `127.0.0.1:8099` (5 s au plus). S'il n'y en a pas, il en lance un (`languagetool --http --port 8099`, sortie vers `/dev/null`) qui vit le temps de la session. Si quelque chose écoute sans répondre, il ne lance rien et le signale (voir Dépannage).
2. À chaque changement du brouillon, après 450 ms sans frappe, le texte est envoyé au serveur local (`/v2/check`, langue détectée automatiquement, variante anglaise `en-US`, 10 s au plus).
3. Les correspondances sont converties en soulignés colorés via `$.prompt.paint`, après une lecture de la boîte par `$.prompt.read` : sans cette lecture, le moteur répond `isPainted: false` et ne dessine rien (piège rencontré en 0.1.0).

Ne sont pas corrigés : commandes `/`, `!` et notes `#`, blocs et code en ligne, URL, chemins, mentions `@fichier`, identifiants `snake_case`, `camelCase` et mélanges lettres/chiffres. Les règles « majuscule en début de phrase » et « point final » sont ignorées, trop bruyantes dans un chat.

![ortho dans rustty : soulignés rouge et bleu dans la saisie, infobulle de correction au survol de « poulle » avec poule, poulie, poulet](https://yrbane.github.io/shots/ortho.webp)

## Corrections au survol, avec rustty

Le moteur de Claude Code ne transmet aucun événement de souris sur la zone de saisie à un mod : le survol vient donc du terminal. Dans [rustty](https://github.com/yrbane/rustty) (à partir de 0.1.0-alpha.134), poser la souris sur un mot souligné ouvre une infobulle avec le message de LanguageTool et ses suggestions ; un clic sur l'une d'elles la colle dans le terminal sous forme d'un jeton (`U+E000 ortho U+E001 mot U+E001 remplacement U+E001 rang U+E002`) que ce mod consomme dans `prompt.edit` : le mot visé est remplacé dans le brouillon, le curseur replacé, et rien du jeton ne reste. Le rang distingue les occurrences d'un même mot fautif. Contrat détaillé dans la spec de rustty, `docs/superpowers/specs/2026-10-30-spell-popup-design.md`.

Dans un autre terminal, rien ne change : les soulignés restent purement visuels.

## Commande `/ortho`

Affiche l'état interne du correcteur : état du serveur LanguageTool, nombre d'éditions vues, dernière requête, dernière peinture, dernière erreur. C'est le premier réflexe quand rien ne se souligne.

## Dépannage

Plus rien ne se souligne, et `/ortho` indique `serveur LanguageTool : failed` avec « le processus N occupe le port 8099 sans répondre » : un serveur gelé tient le port. Cause typique : une autre session Claude Code, qui avait lancé LanguageTool, a été suspendue avec Ctrl+Z ; son serveur, dans le même groupe de processus, est gelé avec elle, et toutes les sessions se branchent dessus. Deux remèdes : reprendre cette session (`fg`), ou tuer le serveur (`kill -9 N`) ; le mod en relance un neuf dans les 30 s. Depuis 0.2.2, la sortie du serveur ne passe plus par Claude, donc une session suspendue ne bloque plus la JVM sur une écriture ; mais Ctrl+Z la gèle toujours avec la session qui l'a lancée.

Toute requête est bornée (sonde 5 s, vérification 10 s) : un serveur muet rend le mod indisponible, jamais bloqué.

## Installation

Depuis GitHub, à l'invite d'une session Claude Code (`y` pour ajouter la place de marché, puis la portée) :

```
/plugin install ortho --marketplace yrbane/claude-ortho
```

Depuis un clone, pour développer :

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
