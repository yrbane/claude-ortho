# Changelog

## 0.2.2 — 2026-11-25 · « Un serveur gelé ne bloque plus le mod »

- Cause corrigée : une session Claude Code suspendue (Ctrl+Z) gelait le serveur LanguageTool qu'elle avait lancé ; le port 8099 restait pris par un processus qui acceptait les connexions sans répondre, et toutes les sessions, qui le réutilisaient, attendaient indéfiniment : plus aucun souligné.
- Sonde et vérification bornées (5 s et 10 s) par une course entre `$.http.fetch` et l'horloge du moteur, qui n'offre pas de délai maximal.
- Port occupé par un serveur muet : le mod n'en lance pas un autre par-dessus, affiche « le processus N occupe le port 8099 sans répondre » (PID via `ss -ltnp` quand il existe) et l'écrit dans `/ortho` avec le remède ; nouvel essai 30 s plus tard.
- Serveur lancé via `sh -c 'exec languagetool … >/dev/null 2>&1'` : sa sortie ne passe plus par Claude, une session qui cesse de la lire ne bloque plus la JVM sur une écriture.
- Tests : `parseListenerPid`, et le scénario complet d'un serveur qui ne répond pas (toast, diagnostic, aucun lancement ni vérification).
- README : section Dépannage.

## 0.2.1 — 2026-10-30 · « Dépôt public et installation en une ligne »

- Dépôt rendu public ; `.claude-plugin/marketplace.json` fait du dépôt sa propre place de marché : `/plugin install ortho --marketplace yrbane/claude-ortho`.
- README : ligne d'installation depuis GitHub, clone réservé au développement, capture d'écran de l'infobulle dans rustty.

## 0.2.0 — 2026-10-30 · « Correction au survol dans rustty »

- Le mod garde, pour chaque faute soulignée, le mot et les remplacements proposés par LanguageTool (`toCorrections`).
- Jeton de correction : quand le terminal [rustty](https://github.com/yrbane/rustty) colle `U+E000 ortho U+E001 mot U+E001 remplacement U+E001 rang U+E002` (clic sur une suggestion de son infobulle au survol du souligné), le hook `prompt.edit` le consomme sans rien laisser dans le brouillon, remplace l'occurrence visée (par la liste des corrections, sinon par recherche du mot entier dans le texte), replace le curseur et relance une vérification.
- Tests : logique pure du jeton et de l'application, et chaîne complète frappe → peinture → jeton → brouillon corrigé.

## 0.1.0 — 2026-10-30 · « Soulignés orthographe et grammaire dans la saisie »

- Souligné rouge pour les fautes d'orthographe, bleu pour la grammaire, pendant la frappe (anti-rebond 450 ms).
- Serveur LanguageTool local démarré à la demande sur le port 8099, réutilisé s'il tourne déjà.
- Masquage du code, des URL, chemins, mentions et identifiants techniques avant vérification.
- Lecture de la boîte (`$.prompt.read`) avant chaque peinture, condition imposée par le moteur pour que les décorations soient dessinées.
- Commande `/ortho` : diagnostic de l'état interne (serveur, compteurs, dernière requête/peinture/erreur).
- Tests unitaires de la logique pure et test d'intégration de la chaîne complète avec horloge et réseau simulés.
