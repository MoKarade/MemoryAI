<!-- Extrait de l'ancien CLAUDE.md (5. Vérifications avant commit), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# 5. Vérifications avant commit

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

*(`lint` = ESLint CLI, pas `next lint`. Le bloc `ignores` d'`eslint.config.mjs` est
indispensable.)* La **CI** (`.github/workflows/ci.yml`) rejoue ce gate, plus un job `audit`
séparé. Chaque job est borné par `timeout-minutes`.

⚠️ **Une PR de session peut rester SANS AUCUN CHECK, et il faut le vérifier à chaque fois.**
Mesuré le 16/09 sur la #22 : cinq pushes et l'ouverture de la PR, **zéro run** — le dernier
datait du merge précédent. Le workflow écoute `pull_request` et `push` sur `main`/`master`
seulement, donc une branche de travail poussée n'est couverte par rien tant que l'événement
`pull_request` n'est pas émis. Le remède est un **dispatch manuel** (`workflow_dispatch`,
déclaré ici) sur la branche, et il faut LIRE son verdict.

⚠️⚠️ **La CAUSE, elle, n'est pas établie — et la version précédente de ce paragraphe en
affirmait une FAUSSE.** J'avais écrit « GitHub n'émet pas `pull_request` pour une PR créée par
un jeton d'application ». Réfuté le jour même : la PR #364 de DriveAI, créée par le même
chemin, a déclenché son run en `event: pull_request` dans la minute. La différence entre les
deux dépôts n'est pas mesurée. Ce qui reste vrai est le FAIT et le geste ; ce qui a été retiré
est l'explication, parce qu'une doc qui affirme une cause fausse envoie la prochaine session
corriger le mauvais endroit.

⚠️⚠️ **UNE MIGRATION QUI ÉCHOUE BLOQUE LA BASE POUR TOUJOURS, ET LES TESTS NE LE VOIENT PAS.**
Vécu le 16/09 au soir : toute l'app rendait « erreur de base de données » — chat, `/moi`,
`/a-valider`, le hub — avec 608 tests verts et un déploiement `READY`. Deux causes empilées,
et la seconde est ce qui rend la première définitive.
1. `0011` et `0012` portaient **plusieurs commandes sans `--> statement-breakpoint`**. Drizzle
   découpe sur ce marqueur et envoie chaque morceau en UNE requête ; le pilote HTTP de Neon
   refuse alors « cannot insert multiple commands into a prepared statement ». Les tests
   appliquaient par `pg.exec()` de PGlite, qui ACCEPTE le multi-commandes (mesuré) : ils
   validaient un contrat que la production n'a pas.
2. Le migrator `neon-http` **accumule ses `insert` dans `__drizzle_migrations` et ne les
   exécute QU'À LA FIN** (lu dans son code, pas supposé). Une migration qui échoue laisse donc
   toutes les précédentes appliquées et NON enregistrées : elles se rejouent au prochain appel
   et échouent sur « already exists ». Sans idempotence, il n'y a aucun rattrapage possible —
   la base reste bloquée, et le seul chemin est une intervention à la main.

Ce qui tient désormais, et qu'aucune refacto ne doit défaire (`tests/migrationsProd.test.ts`,
les deux mutations rejouées) : les migrations s'appliquent en test **avec l'instrument de la
prod** (`pg.query()`, qui rend le même refus que Neon), et toute migration **ajoutée après le
16/09 est idempotente**. Les neuf historiques qui ne le sont pas sont nommées dans un
inventaire qui ne peut que RÉTRÉCIR — le test échoue aussi si un nom y reste alors que le
fichier est devenu idempotent.

⚠️ **Le gate local était plus strict que la CI, et dans le mauvais sens — réglé le 17/09.**
`core.autocrlf = true` sans `.gitattributes` livrait `scripts/*.mjs` en CRLF, et Vite refusait
la ligne d'import des deux tests qui les importent : deux rouges permanents en local, verts en
CI, et **26 tests qui n'avaient jamais tourné sur ce poste**. Un `.gitattributes` borné aux
`.mjs` le règle. Leçon à garder : deux rouges permanents ne coûtent pas deux tests, ils coûtent
l'habitude de les ignorer.
