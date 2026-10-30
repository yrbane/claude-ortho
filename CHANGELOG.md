# Changelog

## 0.1.0 — 2026-10-30 · « Soulignés orthographe et grammaire dans la saisie »

- Souligné rouge pour les fautes d'orthographe, bleu pour la grammaire, pendant la frappe (anti-rebond 450 ms).
- Serveur LanguageTool local démarré à la demande sur le port 8099, réutilisé s'il tourne déjà.
- Masquage du code, des URL, chemins, mentions et identifiants techniques avant vérification.
- Lecture de la boîte (`$.prompt.read`) avant chaque peinture, condition imposée par le moteur pour que les décorations soient dessinées.
- Commande `/ortho` : diagnostic de l'état interne (serveur, compteurs, dernière requête/peinture/erreur).
- Tests unitaires de la logique pure et test d'intégration de la chaîne complète avec horloge et réseau simulés.
