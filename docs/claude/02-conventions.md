<!-- Extrait de l'ancien CLAUDE.md (2. Conventions de code), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# 2. Conventions de code

- **TypeScript strict**, pas de `any` silencieux. Code, commentaires, commits, docs **en
  français**.
- **Erreurs honnêtes** : chaque mode d'échec se distingue. Sur un endpoint authentifié, une
  PANNE (503 nommé) n'est pas un REFUS (401) ; entre eux, les refus restent indiscernables.
- **Fonctions pures d'un côté, I/O de l'autre.** Ce qui décide (`validerFait`, le vocabulaire,
  les niveaux, le protocole MCP, la troncature du chat) se teste sans base, sans réseau, sans
  horloge.
- **Une seule définition par règle.** Deux implémentations d'une même règle, c'est une règle
  et demie.
- Ne pas imposer le dark mode : `prefers-color-scheme` décide. Direction bento du hub, mobile
  ET PC.
- **Socle visuel commun** (app-template#39, appliqué ici par MemoryAI#126). Les couleurs vivent
  dans `app/globals.css`, en variables hexadécimales (`--fond`, `--texte`, `--accent`,
  `--repere`, `--succes-*`, `--alerte-*`, `--erreur-*`…), clair ET sombre, et nulle part ailleurs.
  Vocabulaire : `.carte` `.bouton` (+ `-principal` `-second` `-danger`) `.champ` `.pastille`
  `.bandeau` `.surtitre` `.doux` et les états `.succes` `.alerte` `.erreur`. `--accent` ne sert
  qu'à l'action principale ; `--repere` : navigation active, surtitre, catégorie, jamais un état.
  Cibles ≥ 44 px, champs à 16 px, aucune ombre, aucune police téléchargée. Verrous :
  `tests/theme.test.ts` (jetons, classes définies, contrastes WCAG, `.champ` sur chaque saisie),
  `tests/couleurs.test.ts` (aucune couleur hors du CSS), `tests/contraste.test.ts` (graphes).
  Une page ou un composant neuf emprunte ce vocabulaire ; il n'invente ni classe ni couleur.
- **Le fuseau de Marc est écrit UNE fois** (`lib/fuseau.ts`). Vercel tourne en UTC : tout
  `Intl.DateTimeFormat` passe `timeZone: FUSEAU`, et `tests/fuseau.test.ts` refuse un fuseau
  écrit en dur ailleurs — une heure fausse est pire qu'une heure absente, parce qu'on la croit.
