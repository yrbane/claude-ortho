# Changelog

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
