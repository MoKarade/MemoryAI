# Refonte de l'interface de MemoryAI — le brief (25/09/2026)

> Document de reprise. Il dit ce que Marc a demandé, ce que l'interface est AUJOURD'HUI (mesuré
> le 25/09 sur `main` = `60af4fd`), et le plan proposé. **Rien n'est codé.** La porte de plan
> s'applique : maquettes → choix de Marc → plan court → OK → exécution.
> Daté : les chiffres ci-dessous sont vrais au 25/09, se re-mesurent avant de s'en servir.

## 1. La demande, et le cadrage tranché par Marc

Marc, 25/09 : « lis tout tout tout, ensuite refonte de l'interface en entier ». Cadrage répondu
en choix multiple le même jour (les quatre recommandations retenues) :

| Question | Réponse de Marc |
|---|---|
| Périmètre | **MemoryAI seule** (pas DriveAI, pas le hub) |
| Ce qui gêne | **les quatre** : on s'y perd · trop de texte · c'est pas beau · mal fait sur téléphone |
| Le centre de l'app | **Lia au centre** : on ouvre sur la conversation, tout le reste derrière un ou deux boutons |
| Méthode | **Maquettes d'abord** : 2-3 directions cliquables sur téléphone, il choisit, puis on code |

Ça prolonge ce qu'il avait déjà dit le 17/09 (ADR 0005 §1) : « trop d'onglets, trop de blabla,
le graphe ne fait aucun sens. Très simple, très épuré, des infos cachées derrière des boutons ».
**L'ADR 0005 reste en vigueur** (graphe retiré, voix éditable et apprise, faits proposés servis
« (à confirmer) ») : la refonte en exécute la partie « interface », elle ne la rouvre pas.

## 2. L'interface aujourd'hui — mesuré

**La barre** (`components/Nav.tsx`, `SECTIONS`) : Parler · Avancement · Chercher · Régler ·
Dépenses. Cinq entrées, là où l'ADR 0004 n° 42 en avait décidé quatre et où Marc veut
maintenant « Lia au centre ».

**Les pages hors barre**, et comment on les atteint :

| Page | Atteinte par | Remarque |
|---|---|---|
| `/questions` — **la pile vrai/faux (L3)** | le bandeau de l'accueil, **seulement si une QUESTION est ouverte** | ⚠️ **défaut** : les cartes « papier lu » et « déduction » ne comptent pas. Sans question ouverte, la pile est inatteignable autrement qu'en tapant l'adresse. Voir BACKLOG `[L3-acces]` |
| `/a-valider` | un bouton dans Régler | doublon partiel de la pile (les faits proposés y sont aussi) |
| `/conversations` | un bouton dans Régler | l'historique est aussi à gauche du chat (L2) |
| `/apps` | un bouton dans Régler | périmètres des jetons |
| `/graphe` | un bouton dans Régler | **retiré par décision** (ADR 0005 n° 1), jamais fait (`[L26c]`) |
| `/moi` | un bouton rouge dans Régler | la purge |
| `/fait/[id]`, `/pieces/[id]` | les liens du chat et des listes | fiches |

**Le poids des pages** (lignes de `page.tsx`) : avancement 358 · régler 343 · questions 324 ·
dépenses 261 · pièces 230 · à-valider 220 · graphe 179. `app/globals.css` : 772 lignes.
Le texte explicatif est l'essentiel du poids : c'est le « trop de texte » de Marc.

**Ce qui se recouvre** : Avancement, Dépenses et Régler parlent tous trois de coûts et de
compteurs ; la pile et `/a-valider` jugent tous deux les faits proposés ; Chercher et
Avancement affichent tous deux « où en est la lecture ».

## 3. Les directions de maquette

Toile : <https://claude.ai/artifact/BUpBxx4n5n2YwUtiWuYZDe> (privée, à Marc).

- **A — Carnet** *(brouillon posé, interactif)* : papier chaud, titres en serif (Fraunces),
  texte en Source Sans 3, un seul accent terre cuite. Trois écrans : Lia · menu · pile.
- **B — Nuit** *(dessinée le 22/10/2026, interactive)* : fond bleu-nuit, texte en Albert Sans léger, un accent
  doré clair (réglable). Pas de cartes : les réponses de Lia s'écrivent à même le fond, le menu est une
  liste de lignes séparées par des filets. Trois écrans : Lia · menu · pile.
- **C — Bento** *(dessinée le 22/10/2026, interactive)* : tuiles plates à bordure fine et coins de 16 px,
  Outfit, mêmes jetons que le hub (`#07090D` / `#0E1014` / `#15181E`) ; l'accent est l'orange de MemoryAI
  (réglable). Le menu est une grille de tuiles de tailles différentes. Trois écrans : Lia · menu · pile.

Les trois sont sur la même toile, côte à côte, lisibles à 390 px, en données fictives.

**Choix de Marc (22/10/2026, 8 h 20, heure du Québec, tâche MemoryAI#8) : direction B « Nuit », sans
mélange.** C'est elle que R1 (le socle) met en jeton : fond bleu-nuit, Albert Sans léger, accent doré clair,
pas de cartes, menu en liste de lignes à filets. A et C restent sur la toile à titre d'archive.

Les trois partagent la même STRUCTURE (celle de la §4), pour que Marc choisisse un style et non
une architecture. Les valeurs entre [CROCHETS] sont des emplacements, jamais des chiffres
inventés.

## 4. L'architecture proposée (à valider sur les maquettes)

**Un écran : Lia.** En tête : le menu (≡), le nom, et une pastille « N à juger » qui n'apparaît
que s'il y a des cartes. En bas : deux ou trois suggestions et la saisie. Pas de barre d'onglets.

**Le menu** (plein écran sur téléphone, tiroir sur PC), une ligne par entrée, une phrase d'état :

| Entrée | Remplace | Contient |
|---|---|---|
| Vrai ou faux | `/questions`, `/a-valider` | la pile (papiers lus, déductions, questions) |
| Ce qu'elle sait | Chercher, fiches | recherche + « ce que je sais de toi » par domaine |
| Lecture des papiers | Avancement | une jauge, le reste, la vitesse — le détail sous un « ? » |
| Dépenses | Dépenses | le coût du mois et les plafonds |
| Anciennes conversations | `/conversations` | (et à gauche du chat sur PC) |
| Réglages | Régler, `/apps`, `/moi` | voix de Lia, plafonds, jetons, purge |

`/graphe` disparaît (`[L26c]`). Les explications longues passent derrière un « ? » (`[L26d]`).

## 5. Les contraintes qui ne bougent pas (et leurs gardes)

- `tests/gardePages.test.ts` : toute page appelle `requireSession()` et déclare
  `force-dynamic` ; toute Server Action revérifie la session.
- `app/manifest.ts` dérive `start_url` de `SECTIONS[0]` (leçon n° 23) : si `SECTIONS`
  disparaît, dériver de la nouvelle source, jamais écrire `/` en dur.
- `app/rafraichirCompteurs.ts` : source UNIQUE des `revalidatePath` (leçon n° 20) — à
  refaire suivre si des pages fusionnent.
- `tests/couleurs.test.ts` : aucune couleur en dur, tout token employé est déclaré, contrastes
  mesurés (leçons n° 16 et 32). Les deux thèmes suivent `prefers-color-scheme`.
- Une LISTE ne déchiffre jamais le contenu N3/N2 de cent papiers (leçon n° 41, ADR 0012 §2.5).
- Un `<details>` replié EXPÉDIE quand même son contenu (leçon n° 21) : pas de contenu
  sensible « caché » dans un dépli d'une page de liste.
- Cibles tactiles ≥ 44 px, champs à 16 px, largeur de référence 390 px.
- Pas de préversion Vercel pour `claude/*` : une PR d'interface se fusionne pour être vue.

## 6. Le plan proposé (un lot = une PR, en ligne avant le suivant)

0. **Maquettes** *(fait : B « Nuit » choisie par Marc le 22/10/2026)* : finir A, dessiner B et C ; Marc choisit (et peut mélanger).
1. **R0 — `[L3-acces]`** *(avant tout, petit)* : la pile atteignable (pastille « à juger »
   comptée sur TOUTES les cartes de la pile). C'est un défaut du lot 3, pas de la refonte.
2. **R1 — le socle** : tokens (couleurs, typo, espacements) de la direction choisie, gabarit
   d'écran, menu ; la barre d'onglets disparaît.
3. **R2 — Lia** : l'écran de conversation redessiné (bulles, sources, suggestions, saisie).
4. **R3 — Vrai ou faux** : la pile + `/a-valider` fusionnés.
5. **R4 — Ce qu'elle sait** : recherche + fiches.
6. **R5 — Lecture et Dépenses** : un écran court chacun, le détail derrière « ? ».
7. **R6 — Réglages** : Régler + Apps + purge ; `[L26b3]` la voix de Lia.
8. **R7 — le ménage** : retrait du graphe (`[L26c]`), des pages mortes et de leurs tests.
