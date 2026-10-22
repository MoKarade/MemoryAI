# BACKLOG — MemoryAI

Ce qui est décidé mais pas fait. Le plan de la phase 0 fait foi dans l'ADR 0001 §8 ; ici,
l'état de chaque lot et ce qui a été découvert en chemin.

## Phase 0

| Lot | Contenu | État |
|---|---|---|
| 0 | ADR 0001 + identité `memoryai` + `vercel.json` | ✅ accepté par Marc le 15/09, PR #1 |
| 1 | Auth par le hub, `accesHub.ts` supprimé + test, en-têtes de sécurité, `MEMORYAI_GEL` | ✅ |
| 2 | Neon + 7 tables + migrations au démarrage + chiffrement (AAD) + journal chaîné | ✅ |
| 3 | `validerFait()` + vocabulaire v1 + `POST /api/faits` + `oublis` + corpus adversarial | ✅ |
| 4 | MCP `memoryai` (5 outils) + OAuth porté de CarAI | ✅ |
| 5 | UI `/moi` `/a-valider` `/fait/[id]` + chat + `/hub/summary` + PR hub | ✅ (PR hub #59) |
| 6 | Seed 80-150 faits depuis la session, validés en lot par Marc | ✅ 105 faits envoyés le 15/09 à 20:44 (3 lots, 0 refusé), 98 validés par Marc, 7 rejetés |

## Refonte de l'interface (Marc, 25/09/2026) ⬜

Brief, cadrage et plan : [`docs/REFONTE-INTERFACE.md`](docs/REFONTE-INTERFACE.md). Porte de plan :
maquettes → choix de Marc → plan court → OK.

- [x] **[L3-acces] La pile est inatteignable sans question ouverte** — trouvé le 25/09 ; corrigé
  le 15/10/2026 (MemoryAI#90). Le bandeau de `app/page.tsx` compte maintenant la pile elle-même
  (`composerPile` + `restantParGenre`, via `lib/pile/charger.ts` et `lib/pile/bandeau.ts`) : « N à
  juger » dès qu'il reste une carte non jugée et non passée, rien quand la pile est vide.
- [x] **[R0] Maquettes** — A « Carnet », B « Nuit » et C « Bento » sont sur la toile (B et C dessinées le
  22/10/2026, MemoryAI#7) ; Marc a choisi B « Nuit » le 22/10/2026 (MemoryAI#8).
- [ ] **[R1…R7]** — le plan de `docs/REFONTE-INTERFACE.md` §6, lot par lot.

## [L3] La pile « vrai / faux » (ADR 0012, 24/09/2026) 🟦

- ✅ `/questions` devient une PILE, une carte à la fois : papiers LUS, déductions (faits
  proposés), questions. Ordre PUR (`lib/pile/composer.ts`) : titulaire incertain (< 80 %) d'abord,
  puis 04, 01, échéances de l'année, le reste ; une déduction ou une question toutes les 4 cartes.
- ✅ Vrai / Faux / Passer toujours visibles, glisser sur téléphone (`components/CarteGlissable.tsx`).
- ✅ Table `avis_pile` (migration 0018, en AJOUT SEUL, remarque chiffrée) : un avis ne modifie
  aucune pièce. Un papier contesté reste servi au chat, marqué `avis_marc="conteste"` ; la fiche
  du papier montre l'avis et la remarque.
- ✅ Revue #73 corrigée avant fusion : l'intercalage se compte sur les cartes JUGÉES (il ne se
  produisait jamais, l'écran ne montrant que la carte du dessus) ; le glisser n'agit qu'au doigt,
  avec capture du pointeur ; une remarque illisible ne fait plus planter la fiche ; un avis n'est
  consigné que sur une carte qui existe (un papier d'inventaire ne peut pas être « confirmé »).
- ⬜ Revue #73, non corrigé : sans `MEMORYAI_N3_CHAT`, les papiers N3 apparaissent « non
  affichables » en tête (rang 04) avec « Passer » pour seul geste. Sans effet tant que la
  variable est posée (le cas de production).
- ⬜ Revue #73 : `avis()` relit toute la table `avis_pile` à chaque chargement, et chaque « Passer »
  ajoute une ligne. À surveiller ; une fenêtre (derniers N jours) suffira le jour venu.
- ⬜ Mesurer en production : juger 5 cartes, vérifier qu'un « faux » change la réponse du chat.
- ⬜ [L3b] La RELECTURE d'un papier contesté : DriveAI le relit en priorité, et la Mémoire accepte
  une relecture du même rang pour un papier contesté (amendement de l'ADR 0008). Deux dépôts.
- ⬜ [L3b] Les DOUBLONS (« ces photos sont-elles le même passeport ? ») : fusionner des pièces est
  une écriture, pas un avis.

## [L2] Le chat qui sait tout de Marc, et à lui seul (ADR 0011, 24/09/2026) 🟦

- ✅ N3 fermé au MCP par liste blanche de lecteurs (`LECTEURS_N3`), schéma `tools/list` aligné,
  facettes N3 retirées au MCP.
- ✅ Case N3 cochée par défaut dans le chat.
- ✅ Filtre `titulaires`, plein texte N3 en mémoire (chat seulement), prompt qui nomme les
  outils de papiers.
- ✅ Historique des conversations à gauche, reprise d'une conversation, « Nouvelle
  conversation » qui remet l'identifiant à zéro.
- ✅ Mesuré en production le 24/09 : le chat trouve le passeport (case non touchée) ; claude.ai
  n'en rend que le sommaire, et `types: ["Passeport"]` y rend « aucune pièce ».
- ✅ 24/09, défaut vu par Marc sur ce même test : la réponse portait « (non sourcé) ». Les
  outils de papiers ne déclaraient RIEN comme servi, donc la citation d'un papier réel était
  traitée comme une invention. `piecesServies` (`lib/mcp/outils.ts`) + citation
  `[→/pieces/<id>]` + lien Drive du papier reconnus (`lib/chat/liens.ts`) ; un papier cité sous
  la forme `/fait/<id>` est ramené à sa fiche. Aucun appariement de texte pour les papiers :
  « passeport » désigne aussi ceux des proches.
- ✅ 24/09, compte Anthropic à sec : `/api/chat` rendait un 500 SANS CORPS et l'écran affichait
  « Unexpected end of JSON input ». Le refus est désormais NOMMÉ (`lib/chat/erreursModele.ts` :
  crédit épuisé — console API, pas claude.ai —, clé refusée, débit, surcharge) et l'écran lit le
  texte avant le JSON. Gardes : `tests/liensPapiers.test.ts` (5 mutations rouges).
- ✅ Revue #72 corrigée avant fusion : un `[↗…]` collé à une citation doit être le lien de CETTE
  source (le lien servi du passeport d'un proche passait pour celui de Marc) ; coupure réseau
  vers Anthropic nommée (`modele_injoignable`) ; classement par CLASSE du SDK (un objet maison
  portant `status` n'est plus pris pour un refus du modèle) ; dernier message ≠ Marc → 400.
- ✅ 29/09 : `forme: "complete" | "sommaire"` porté dans `PieceServie` (obligatoire — un
  appelant qui l'oublie ne compile pas), depuis `lib/pieces/lecture.ts` (`sortDeLaPiece`) qui
  le savait déjà. Une citation d'un papier servi en SOMMAIRE reste GARDÉE (l'id a bien été
  servi) mais reçoit « (sommaire) », comme un fait `propose` reçoit « (à confirmer) » :
  marqué, pas bloqué. La limite jumelle pour les FAITS (« un id servi valide toute phrase »)
  reste entière — structurelle à l'appariement par valeur, hors de portée d'une marque de
  forme. `lib/chat/liens.ts`, `lib/mcp/outils.ts`, `tests/liensPapiers.test.ts` (traverse,
  vrai passeport N3 en base). Revue pole-securite demandée (confiance des citations).
- ⬜ Revue #72, préexistant : `journaliserAcces` ne consigne que les FAITS servis — les papiers lus
  par le chat (N3 compris) n'apparaissent pas au journal d'accès.
- ✅ 29/09 : une citation dont l'UUID est en MAJUSCULES est reconnue (comparaison en
  minuscules) et RÉÉCRITE dans la casse canonique — sinon le lien rendu pointe une fiche
  qui 404 (`/fait/[id]` et `/pieces/[id]` valident un id en minuscules). `lib/chat/liens.ts`,
  `tests/liensCites.test.ts`.
- ✅ 16/10 (tâche #106) : le journal d'accès note le niveau de ce qui est RÉELLEMENT sorti —
  un papier N3 servi en SOMMAIRE vaut 2 au plus (`niveauServi`, `lib/pieces/lecture.ts`),
  un papier complet garde son niveau. `lib/mcp/outils.ts`, `tests/niveau3.test.ts`,
  `tests/niveau3Lecteurs.test.ts`.
- ⬜ Découvert en chemin, non corrigé : un papier SANS dossier (1 913 le 24/09, presque tous des
  inventaires jamais lus) est au régime chiffré (`dossierReconnu` faux) sans être N3 — donc ni
  le plein texte Postgres ni la recherche N3 en mémoire ne le voient. Sans effet tant qu'ils ne
  sont pas lus (rien à chercher) ; la lecture vision leur donne un dossier.

## [L42] L'onglet Avancement — ce que DriveAI publie, et où en sont les papiers (Marc, 23/09/2026) 🟦

- ✅ ADR 0009 : DriveAI pousse des COMPTES (classés, envoyés, file par dossier, série par jour),
  jamais un nom de fichier ni un fait. Table `avancement_sources`, une ligne par app, écrasée.
- ✅ `POST /api/avancement` : jeton d'écriture, 401 indiscernable (lecture compris), gel ⇒ 503,
  413 au-delà de 32 Ko, 422 qui nomme les CHAMPS et jamais les valeurs.
- ✅ Onglet Avancement (5ᵉ, après Parler) ; le suivi de lecture quitte Dépenses.
- ✅ Barre de navigation qui passe à la ligne sur téléphone (mesurée à 674 px pour 390).
- ⬜ Côté DriveAI : le producteur (`POST /api/avancement` au plus toutes les 30 min, budget pris
  sur l'enveloppe), à livrer APRÈS le déploiement de ce lot.
- ⬜ Mesurer l'écran en production avec les vrais nombres, une fois DriveAI branché.
- ⚠️ 24/09 : la fusion de #64 (`3613b30`) n'a créé AUCUN déploiement Vercel — push manqué par
  l'intégration Git, cas déjà vu dans l'écosystème. Rattrapé par un nouveau push sur `main` (celui-ci),
  jamais par « Redeploy », qui aurait rejoué `027c18d`.
- ✅ 29/09 : committé délibérément. Next l'annonce lui-même MANDATORY (« next.js uses the
  React automatic runtime »), pas une suggestion : `jsx: react-jsx` et l'ajout de
  `.next/dev/types` dans `include` sont désormais la valeur de référence. Le commentaire de
  `vitest.config.ts` qui citait l'ancien `jsx: preserve` (obsolète) est corrigé en même temps.
- ⚠️ 24/09 : le réveil `apprentissage.yml` rend HTTP 401 — `CRON_SECRET` côté GitHub diffère de
  celui de Vercel (401 = secret différent, 503 = absent). Recopier la valeur EXACTE depuis Vercel.

## [L41] « Combien la mémoire sait sur moi, en tout » (Marc, 21/09/2026) ✅

Marc : « j'ai toujours seulement 100 faits validés, pourquoi ? c'est pas clair », puis
« je veux un compteur pour avoir genre le nombre d'info que l'app a sur moi EN TOUT, et le
voir dans memory ai et hubperso ».

- [x] **`lib/totalInformations.ts`, PUR et testé** — la somme des postes DÉCLARÉS, un poste
  non mesuré fait disparaître le total (jamais une somme amputée), et la décomposition est
  DÉRIVÉE de la même liste que la somme (`Record<ClePoste, …>` exhaustif : ajouter un poste
  sans le nommer ne compile pas).
- [x] **Le hub publie « Informations » en métrique PRINCIPALE**, et « Faits validés » perd
  son `primary`. Les deux postes restent publiés à côté — la garde est la RELATION
  (`total === faits + papiers` sur les valeurs réellement publiées), jamais un libellé.
- [x] **`/regler` affiche le total en tête**, hors du repli, avec sa décomposition sous le
  nombre ; le `<summary>` d'État nomme les DEUX postes au lieu du seul compteur trompeur.
- [x] 4 mutations jouées, 4 rouges, référence et restauration vertes (25 tests).

⚠️ **Ce qui reste vrai et n'est PAS réglé par ce lot** : lire un papier n'écrit toujours
aucun FAIT. Le compteur dit maintenant la vérité sur ce que la mémoire détient ; il ne
change rien au fait que 2 642 papiers sur 2 748 sont des coquilles — la mémoire sait qu'ils
existent, pas ce qu'ils contiennent. Faire produire des faits par la lecture est un lot à
part, avec son ADR et son coût en appels de modèle. **Pas commencé, pas demandé.**

## Installable sur le téléphone (Marc, 18/09/2026 — Android) ✅

- [x] **`id: "/moi"` et `launch_handler: navigate-existing`.** ⚠️ L'`id` vaut `/moi` et non `/`,
  parce que l'identité implicite d'une installation EST son `start_url` — et le nôtre est `/moi`.
  Mettre `/` aurait créé une identité NEUVE, donc une seconde installation : l'inverse du but.
- [x] **La variante `maskable` pointait sur `/icone-192.png`** — donc le MÊME fichier que l'icône
  normale, et sous les 512 px attendus. Remplacée par `/icone-maskable-512.png`.
- [x] Garde : `tests/pwaManifeste.test.ts` (5 cas, 3 perturbations prouvées). Elle relit les
  dimensions dans l'en-tête IHDR des PNG plutôt que de croire le champ `sizes` : une déclaration
  n'est pas une mesure, et Chrome croit le fichier.
- [ ] **⏸️ L'icône de l'app est un APLAT UNIFORME**, sans motif ni lettre — mesuré : une seule
  couleur sur les 262 144 pixels de `icone-512.png`. Elle s'installe et s'affiche très bien, mais
  sur un écran d'accueil qui portera sept apps du parc, un carré de couleur ne se distingue que
  par sa teinte. **Signalé, pas corrigé** : dessiner une icône est une décision de produit, et
  elle n'a pas été demandée. C'est aussi pourquoi la maskable a le même contenu que l'icône
  normale — un aplat rogné reste le même aplat, il n'y a rien à ramener dans la zone sûre.
- [ ] **⏸️ La bascule « le lien du hub ouvre l'app installée » n'est pas vérifiable d'ici** : elle
  dépend de la version de Chrome, de l'installation réelle et d'un réglage système. C'est le
  téléphone de Marc qui tranche. Côté hub, le verrou était un `target="_blank"`, retiré là-bas.

## À trancher (une ligne suffit)

- **[Q13]** « Sélecteur pour toutes les IA dispo » : lu comme *tous les modèles Anthropic*.
  Un autre fournisseur est une décision à part (rétention, clé, coût).

## Découvert en chemin (modèle commun, 30/09/2026)

- ⬜ **[T1]** Une dizaine de suites ont un `beforeAll` (base de test) au-delà de 10 s quand le
  PC est chargé. Compensé par `hookTimeout: 30_000` (vitest.config.ts), qui ne corrige pas la
  cause : mesurer ces `beforeAll` à vide pour savoir si c'est la charge ou une vraie lenteur.

- ⬜ **[T2]** esbuild 0.18.20, dev seulement, via drizzle-kit > @esbuild-kit (déprécié), alerte
  Dependabot n° 1 laissée ouverte ; à revoir à la prochaine version de drizzle-kit.

## Découvert en chemin (lot 3)

- **[V2]** Les prédicats N3 acceptent une DATE ou un POINTEUR comme valeur (échéance, fileId),
  jamais un texte : la contrainte SQL s'appelle `faits_n3_sans_texte`, et la colonne
  `attributs` (type, émetteur, année, échéance — liste fermée) porte ce qui permet « où est
  mon avis de cotisation 2024 ». Le brief disait « aucune valeur » : la lecture retenue est
  « aucun CONTENU », ce que l'ADR §5.3 énumère déjà.
- **[P1]** La fiabilité est un PLAFOND par écrivain (`lib/jetons.ts`) : DriveAI peut déclarer
  `document-officiel`, son défaut est `document-tiers`. À brancher dans `Memoire.gs`.

## Découvert en chemin (lot 4)

- **[P1]** La bascule N2 « par conversation » (Q11) est, côté MCP, un argument `inclure_n2`
  par APPEL, journalisé : le protocole MCP n'a pas de notion de conversation. C'est plus
  strict que la décision (elle retombe à OFF à chaque appel), pas moins.
- **[P1]** `MEMORYAI_N2_CHAT` gate le N2 vers TOUT lecteur-modèle (MCP compris), pas
  seulement le chat : même fournisseur, même rétention. Le nom est resté pour ne pas créer
  une seconde variable.
- **[V2]** La recherche (`memoryai_chercher`) est lexicale (termes normalisés, score sur le
  prédicat, la valeur, les attributs) : suffisante pour la DoD, à mesurer sur le seed du lot 6
  avant de penser à un index.

## Découvert en chemin (lot 5)

- **[P1]** Valider un fait d'un prédicat non multiple (`emploi.employeur`) périme l'ancien
  validé mais n'écrit pas `remplace_id` sur le nouveau : la colonne existe, le lien n'est pas
  posé. À faire quand l'historique d'un fait s'affichera.
- **[P1]** `/a-valider` n'a ni pagination ni validation en lot : 100 faits par page, un geste
  par fait. Suffisant pour le seed du lot 6 (≤ 150) ; à revoir quand DriveAI alimentera.
- **[P2]** Le hub proposera « MemoryAI » dans `/administration` (dérivé de `SOURCE_DEFS`) alors
  que MemoryAI n'appelle jamais `POST /api/acces` : accorder l'accès n'ouvre rien. Dit dans le
  `.env.example` du hub ; un drapeau `sansInvites` sur `SourceDef` serait plus propre.

## Découvert en chemin (lot 24)

- **[P1] Le défaut des graphies était PRÉVU par la question n° 8 du socle**, figée avant le
  code : « l'émetteur est écrit de trois façons ». Deuxième fois que `lib/questionsTest.ts`
  nomme un défaut avant son apparition — c'est ce qui rend une mesure figée plus utile qu'un
  test écrit après coup.
- **[P1] On ne peut pas chercher par PRÉFIXE, et ce n'est pas un oubli** : les émetteurs sont
  filtrés par clé keyée (HMAC), justement pour que deux pièces portant « Banque Aurore » se
  retrouvent malgré des chiffrés différents. Un hash n'a pas de préfixe. La seule voie est
  d'exposer les regroupements au MODÈLE, qui décide ensuite.
- **🟡 [P2] UNE MUTATION A RÉVÉLÉ DU CODE MORT.** Le filtre des suffixes juridiques
  (`inc`, `ltee`…) ne pouvait rien changer : on ne garde que le premier mot, « inc » est
  toujours le second. La mutation qui le retirait laissait tout vert — c'était de la redondance
  déguisée en garde. Retiré. ⚠️ Une mutation muette n'accuse pas toujours le test : ici elle
  accusait le CODE, et c'est le cas le plus utile.
- **[P2] Mon attendu était faux avant que le code le soit** : 173 pour Facebook, mesuré 166,
  parce que « Meta-Facebook » commence par « Meta ». C'est l'attendu qui a changé, et la limite
  est écrite dans le module — un test qui encode ce qu'on croit trouver ne mesure rien.
- **🟡 [P2] `Anthropic, PBC` et `Anthropic, PBC_2` se regroupent bien**, mais le `_2` reste un
  artefact suspect dans les données : ça ressemble à une déduplication qui a renommé au lieu de
  fusionner. Non investigué (hors périmètre) — à regarder côté DriveAI si ça se reproduit.

## Découvert en chemin (lot 23)

- **🔴 [P1] 26 TESTS N'AVAIENT JAMAIS TOURNÉ SUR CE POSTE.** `core.autocrlf = true` sans
  `.gitattributes` livrait les deux `.mjs` à shebang en CRLF, et Vite refusait la ligne
  d'import des deux tests qui les importent. Le gate local portait donc deux rouges permanents,
  là où la CI (Linux, LF) était verte. **Le coût n'était pas les deux rouges, c'était
  l'habitude** : un vrai rouge apparu à côté se serait perdu dedans. Réglé par une règle
  BORNÉE aux `.mjs` — un `* text=auto` global réécrirait tout le dépôt pour un défaut qui
  touche deux fichiers.
- **🔴 [P1] Un outil qui tronque sans dire le total fait inventer des bornes basses.** Mesuré
  sur les captures de Marc : « au moins 214 papiers », « au moins 68 Banque Aurore », contre 2 723
  et 75. Le modèle n'avait pas menti, l'outil ne lui disait rien — et une borne basse inventée
  est présentée comme un fait. ⚠️ La troncature était à DEUX étages : compter les lignes
  rendues n'aurait corrigé que la tranche, pas la borne de lecture en base. Il fallait un COUNT.
- **🔴 [P1] Un défaut par PRÉ-REMPLISSAGE ne demande aucune erreur, juste de la confiance.**
  « Épingler » proposait le premier prédicat du vocabulaire et la réponse entière du modèle. Un
  clic suffisait pour écrire une phrase de 200 caractères sous un prédicat sans rapport, en
  fiabilité `marc` (la plus haute). C'est la classe la plus difficile à voir en relecture :
  le code est juste, c'est le DÉFAUT proposé qui est faux.
- **[P1] Le schéma bornait `annee` mais pas les DATES.** Deux représentations de la même chose,
  une seule gardée — visible seulement en lisant les deux côte à côte. D'où l'échéance au
  2125-03-23. ⚠️ **La pièce fautive est toujours en base** : la borne empêche la récidive, elle
  ne nettoie pas le stock (à retirer d'un clic dans `/pieces`).
- **[P2] Mes deux premières mutations ne mesuraient rien**, et c'est instructif : l'une a cassé
  la syntaxe du fichier (« no tests », donc zéro information), l'autre ajoutait un `LIMIT 4` à
  un `count(*)` — **un LIMIT ne limite pas un COUNT**, la requête rend toujours une ligne
  portant le vrai total. Une mutation qui ne rougit pas accuse d'abord la MUTATION.

## Découvert en chemin (lot 22)

- **🔴 [P1] UNE MUTATION MUETTE A RÉVÉLÉ UN DÉTECTEUR BRANCHÉ PAR RIEN.** Débrancher
  `doublonsExacts` de `poserContradictions` laissait 19 tests sur 19 VERTS : tous appelaient le
  détecteur en direct, aucun ne traversait la passe. Le code était juste, testé, et n'était
  appelé par personne. Pire : le TITRE de mon test annonçait « retirer de la passe fait rougir
  ce cas » — un titre qui affirme une couverture qu'il n'a pas est plus dangereux qu'un test
  absent, parce qu'il éteint la question. Fermé par une garde qui va de l'état en base jusqu'à
  la question posée. **La leçon de conduite : jouer la mutation, pas la supposer** — j'ai écrit
  ce titre en croyant décrire ce que le test faisait.
- **[P1] Le plan Vercel est `hobby`, donc UN cron par jour maximum** (mesuré par `list_teams`,
  pas supposé). « En continu » ne peut donc pas passer par `vercel.json` sans payer, ce que la
  règle « tout gratuit » interdit. GitHub Actions planifie gratuitement et est déjà dans le
  parc — le workflow ne fait qu'un POST, aucune donnée ne transite par le runner.
- **[P1] Ce qui borne la dépense n'est pas la fréquence, c'est le budget par poste.** Huit
  réveils par jour ne peuvent pas dépenser plus qu'un : les passes suivantes sortent sur
  « budget » sans appeler de modèle. C'est ce qui rend le « continu » sûr — et la détection des
  contradictions, gratuite, est justement ce qui profite le plus de la fréquence.
- **[P2] « Garder les deux » n'est pas une option du QCM** : c'est le bouton « Écarter » qui
  existe déjà, et dont la sémantique (une question écartée ne se repose jamais) est exactement
  « je ne veux pas trancher ». Inventer une troisième forme d'option qui ne valide ni ne rejette
  rien aurait ajouté un chemin mort dans l'action.
- **[P2] Les rejets s'appliquent APRÈS la validation**, jamais avant : une coupure entre les
  deux laisse un fait validé de trop (visible, et la question se repose) plutôt qu'un prédicat
  vidé de tout ce qui le portait.
- **🟡 [P2] Il reste un levier de « feed continu » que seul Marc peut brancher** : le hook
  `Stop` de Claude Code (`~/.claude/settings.json`), mesuré ABSENT le 17/09. Sans lui, aucune
  de ses sessions Claude Code n'alimente la mémoire — et c'est là qu'il passe ses journées. Il
  exige `MEMORYAI_TOKEN_CLAUDECODE_ECRITURE`, donc un secret : irréductible.

## Découvert en chemin (lot 21)

- **[P1] `origine: "regle"` attendait un producteur depuis l'ADR 0002 §5.1.** Le `HANDOVER`
  disait « rien ne pose encore de question tout seul » ; c'est ce lot qui l'alimente, et par
  un producteur qui n'appelle AUCUN modèle. La valeur d'énumération existait, sa porte était
  ouverte, personne n'entrait — variante de `UN-CHAMP-TYPE-SANS-PRODUCTEUR` sur une valeur
  d'enum plutôt que sur un champ.
- **🔴 [P1] LE COMMENTAIRE D'UNE MIGRATION NE PEUT PAS CITER LE MARQUEUR DE DÉCOUPAGE.** Le
  découpage de Drizzle est un `split()` sur la chaîne, pas un analyseur SQL : écrire le
  marqueur en toutes lettres dans un commentaire coupe le fichier au milieu de la phrase, et
  Postgres reçoit un morceau qui commence par une apostrophe inverse orpheline. Et le
  paragraphe qui l'a déclenché était précisément celui qui EXPLIQUAIT le piège du découpage.
  Classe à retenir : **un texte qui décrit un séparateur ne peut pas contenir ce séparateur** —
  même famille que « une garde écrite à côté de son sujet lit son propre commentaire ».
- **🔴 [P1] Une table TEMPORAIRE ne survit pas d'une instruction à l'autre en production.** Mon
  premier jet de `0014` en utilisait une entre trois instructions. Le migrator `neon-http`
  envoie chaque morceau dans une requête DISTINCTE, donc elle aurait disparu — en production
  seulement, PGlite l'aurait laissée passer. Réécrite en UNE requête atomique, ce qui supprime
  au passage la question de l'ordre entre « restaurer » et « périmer ».
- **🔴 [P1] C'est un test EXISTANT qui a trouvé le pire défaut du lot** : `tests/db.test.ts`
  exige que `drizzle/meta/_journal.json` décrive exactement les fichiers SQL committés. Mes
  deux migrations n'y figuraient pas — elles n'auraient jamais été jouées en production, avec
  une suite verte. Le test portait déjà la phrase qui l'explique. **Écrire un fichier `.sql`
  n'est pas livrer une migration.**
- **[P1] Aucune hiérarchie de fiabilité n'existe dans ce dépôt**, et ce lot n'en a pas écrit.
  `FIABILITES` est une liste plate ; rien ne dit que « document » bat « modèle ». C'était la
  question posée à Marc le 17/09, et il a choisi le QCM plutôt qu'un arbitre automatique. À
  rouvrir seulement si les questions deviennent trop nombreuses pour être répondues — et alors
  avec une mesure, pas une intuition.
- **🟡 [P2] Le formulaire « Épingler » du chat pré-remplit le MAUVAIS prédicat et la phrase
  ENTIÈRE du modèle.** Vu sur une capture de Marc : réponse sur le bail de logement, prédicat
  proposé `emploi.employeur`, valeur pré-remplie « Ton bail se termine le **30 juin 2028**
  (validé). Il a débuté le 1er avril 2025, appartement… ». Épingler ainsi fabrique un fait
  pourri sous un prédicat sans rapport. Non corrigé (hors périmètre), mais c'est un piège
  ACTIF : c'est aussi ce qui rendait infaisable le test « épingle une date de bail, ça doit
  être refusé » que j'avais proposé.
- **🟡 [P2] `memoryai_papiers_chercher` tronque à 100 sans dire le TOTAL.** Mesuré sur les
  captures de Marc : le modèle a répondu « au moins 214 papiers », puis « au moins 68 papiers
  Banque Aurore », avant de se corriger à 2 723 via les facettes. Un outil qui tronque sans
  publier le total fait INVENTER des bornes basses à son lecteur — c'est `no-fake-data` vu
  depuis la sortie. La facette, elle, rend le vrai compte : la recherche devrait faire pareil.

## Découvert en chemin (lot 20)

- **🔴 [P1] LE DÉFAUT A ATTEINT LES DONNÉES DE MARC, ET LA NOTE QUI L'ANNONÇAIT AVAIT ÉTÉ
  ÉCRITE LE MATIN MÊME.** Le `BACKLOG` du 17/09 à 09:00 disait « question à trancher AVANT de
  coder : existe-t-il une dédup sur ce chemin ? ». À 12:27, Marc validait les six doublons et
  cinq faits corrects passaient `perime`. **Un avertissement écrit dans un document n'est pas
  une garde** : seul le code qui refuse l'est. C'est la version la plus nette de cette classe
  à ce jour — la note était juste, datée, au bon endroit, et elle n'a rien empêché.
- **[P1] Deux trous, pas un — et le second était le plus grave.** (1) rien n'empêchait le
  doublon d'entrer (l'idempotence est par SOURCE, et la source différait bien) ; (2) rien ne
  montrait ce qui avait été PÉRIMÉ. Le premier fabrique une mauvaise décision, le second la
  rend irréversible *en apparence* — alors que `valider` savait déjà réparer. Devant un défaut
  qui a coûté des données, chercher **les deux** : ce qui l'a permis, et ce qui empêche d'en
  revenir.
- **[P1] Une mutation a resserré la garde sur le canal principal.** Sans filtre `multi`, la
  garde refusait les `document.existe` (canal DriveAI, ~4 240 faits) : un reclassement aurait
  produit des refus là où il y avait des `dejaPresents`. Le critère n'est pas « est-ce le même
  fait ? » mais « valider ce fait PÉRIME-t-il quelque chose ? » — donc `multi: false`.
- **🟡 [P2] Un prédicat en quarantaine est traité comme MULTIPLE par la garde**, faute de
  définition. C'est le côté sûr (refuser une écriture sur la foi d'une définition absente
  serait décider à partir de rien), mais ça veut dire qu'un prédicat neuf peut accumuler des
  doublons jusqu'à sa sortie de quarantaine. À revoir si ça se voit dans la file.
- **🟡 [P2] `perime` n'a pas d'horodatage à lui.** `valider` écrit le statut sans date (seul le
  gagnant reçoit `valide_le`), donc « Faits remplacés » se trie par date de CRÉATION. C'est
  honnête ici — le périmé est toujours l'ancien — mais un tri par « quand a-t-il été
  remplacé ? » demanderait une colonne.

## Découvert en chemin (lot 19 bis)

- **🔴 [P1] DEUX SIGNAUX DE FRAÎCHEUR MORTS DE LA MÊME FAÇON, À DEUX HEURES D'INTERVALLE.**
  Le lot 19 a mesuré que `aValider` n'était plus un signal (le canal DriveAI entre directement
  en `valide`) et a désigné en remplacement le `nombre` du prédicat `document.existe`. Le lot
  17, deux heures plus tard, a migré ces faits en papiers **sans les retirer des compteurs** :
  `comptes()` ne filtrait que `supprimeLe`. Résultat mesuré le 17/09 : le compteur figé à
  **2 729** pendant 28 h, quoi qu'il arrive, pendant que la doc disait de le surveiller.
  `estServable` filtrait bien les migrés — la garde existait là où on SERT, pas là où on COMPTE.
  ⚠️ **Rien ne pouvait rougir : un compteur agrégé rend toujours un nombre.** La question à se
  poser avant de désigner un compteur comme signal est « qu'est-ce qui, dans un lot futur,
  changerait ce qu'il agrège ? » — et si la réponse existe, il faut le test qui le dit.
  Corrigé : filtre unique `servis`, `migresEnPiece` publié, métrique « Papiers » au hub,
  3 mutations / 3 rouges.
- **[P1] Un champ REQUIS fait énumérer les appelants par le compilateur.** `papiers` ajouté à
  `ComptesMemoire` a sorti **9 erreurs de typecheck** en une passe, toutes dans un seul objet
  `base` de `tests/admin.test.ts`. Optionnel, il aurait été oublié par un appelant et la carte
  du hub aurait menti en silence — c'est le même arbitrage que `predicatsRetenus` de
  `estServable` (CLAUDE.md §1).
- **[P1] Mon attendu était faux, pas le code.** Le premier jet du test exigeait
  `comptesParDomaine().emploi === 1` après migration : cette fonction ne compte que les faits
  `valide`, et seul le couple mécanique `moteur-inventaire-v1` × `document.existe` s'auto-valide
  (ADR 0003) — le fait d'emploi reste `propose`. Ce que la correction a rendu visible et qui
  vaut d'être su : **après la migration, la ventilation publiée au hub est VIDE** tant que Marc
  n'a rien validé. C'est exact, et c'est précisément pourquoi la métrique « Papiers » existe.
- **🟠 [P1] Une pièce porte une échéance au 2125-03-23.** Un siècle — très probablement `2025`
  mal lu par Haiku (`d1d379b1`, domaine `01`, document du 2026-03-24). Elle empoisonnerait la
  question n° 6 du socle (« qu'est-ce qui expire dans les 90 prochains jours »), qui compare
  des dates entre elles. Non corrigé : ça demande de décider si l'on plafonne une échéance à
  l'écriture (et à quelle borne), ou si on la signale à Marc pour retrait.
- **🟠 [P1] L'ÉMETTEUR EST ÉCRIT DE TROIS FAÇONS — exactement ce que la question n° 8 avait
  prévu avant le code.** Mesuré sur les 2 723 papiers : Banque Aurore 56 + Banque Aurore Assurances
  12 + Banque Aurore Assurances Générales 7 ; Alphatech 15 + ALPHATECH INDUSTRIES INC. 11 +
  Alphatech Industries 9 ; Zenith inc. 49 + Zenith 6 ; Facebook 151 + Facebook - Meta 9 +
  Meta-Facebook 7 + Facebook Marketplace 6. Plus un `Anthropic, PBC_2` (8) qui ressemble à un
  artefact de déduplication. **« Qu'est-ce que j'ai comme papiers de Banque Aurore ? » rend 56 au
  lieu de 75.** Les questions n° 4 et n° 8 échoueront donc pour une raison qui n'a rien à voir
  avec l'extraction. ⚠️ Le `ceQueLEchecDesigne` de `lib/questionsTest.ts`, figé AVANT le code,
  a nommé ce défaut avant qu'il existe : c'est ce qui rend une mesure figée plus utile qu'un
  test écrit après coup. Piste : une table d'alias d'émetteurs + une facette qui regroupe,
  jamais une normalisation destructive de la valeur stockée.
- **🟠 [P1] DEUX TESTS NE PEUVENT PAS PASSER SUR WINDOWS, ET LA CI NE LE VERRA JAMAIS.**
  `tests/seed.test.ts` et `tests/sourcesConversation.test.ts` importent `scripts/seed.mjs` et
  `scripts/pousser-session.mjs`, qui commencent par un shebang. Le poste de Marc a
  `core.autocrlf = true` et le dépôt n'a **aucun `.gitattributes`** : les deux fichiers sont
  donc convertis en CRLF au checkout, et Vite rend
  `SyntaxError: Invalid or unexpected token` sur la ligne d'import. **Mesuré, pas supposé** :
  les mêmes deux fichiers passent (2/2) dès qu'on retire les `
`, et ils échouent aussi sur
  `origin/main` — ce n'est pas un lot qui les a cassés. En CI (Linux, LF) ils sont verts, donc
  **le gate local de Windows est plus strict que la CI, et dans le mauvais sens** : il rend
  deux rouges permanents qu'on apprend à ignorer, ce qui est exactement ce qui fait rater le
  jour où un vrai rouge apparaît à côté. ⚠️ Correctif probable : un `.gitattributes` avec
  `*.mjs text eol=lf` (ou `* text=auto eol=lf`). Non fait : ça touche les fins de ligne de
  TOUT le dépôt sur TOUS les postes, ce n'est pas une décision à prendre en passant dans un
  lot sur les compteurs. ⚠️ Corollaire de conduite, déjà payé ailleurs : **un gate rouge se
  LOCALISE avant d'être expliqué** — le réflexe était d'accuser mon lot, c'est `git checkout
  origin/main` puis le même test qui a tranché en une minute.
- **🟡 [P2] 1 568 papiers sur 2 723 (57 %) ont l'émetteur « Inconnu ».** L'inventaire migré ne
  portait que ce que le NOM du fichier disait. Ce n'est pas un défaut — c'est la mesure de ce
  que le rattrapage de contenu doit encore couvrir.

## Découvert en chemin (lot 18)

- ~~**[P2] Deux classes CSS sont employées et définies NULLE PART**~~ — **FAIT le 16/10/2026
  (MemoryAI#126)** : les deux classes sont remplacées par le vocabulaire du socle, et
  `tests/theme.test.ts` refuse désormais une classe statique employée et non définie. Texte
  d'origine : `.actions-ligne` et
  `.secondaire`, dans `app/a-valider/page.tsx`. Préexistant, non causé par ce lot, et sans
  conséquence visible autre qu'une mise en page brute à ces endroits — mais c'est le même
  mécanisme que la panne de cibles tactiles de DriveAI le 17/09 : une règle qui ne s'applique
  pas ne laisse aucune trace, contrairement à une règle fausse. Un test-garde qui refuse une
  classe employée et non définie fermerait la classe entière ; non corrigé faute de feu vert.

## Découvert en chemin (lot 16)

- **🟠 [P1] PREMIÈRE PASSE RÉELLE DU CRON (17/09, 09:00 UTC) : elle marche, et elle re-propose
  ce qui est DÉJÀ validé.** Six faits `propose` produits par `conversation-v1`, zéro canari,
  zéro erreur — la mécanique est bonne. Mais les six sont des doublons de faits déjà `valide` :
  début et fin du bail logement, début, fin et km du bail véhicule, un fournisseur. **Deux
  d'entre eux portent une valeur strictement identique à celle déjà validée**, caractère pour
  caractère — donc ce n'est pas une affaire de formulation. Un troisième est APPAUVRI (l'émetteur
  du bail a disparu de la valeur), et la fiabilité DESCEND au passage : `document-tiers` (validé)
  devient `app` (proposé). Cinq des six prédicats sont déclarés `multi: false` et portent
  désormais deux faits chacun.
  La question à trancher AVANT de coder : **existe-t-il une dédup sur ce chemin, et pourquoi deux
  valeurs identiques la traversent-elles ?** Si la passe tourne tous les jours en re-proposant le
  même stock, `/a-valider` se remplit de redites — c'est exactement le risque n° 1 du projet
  (§9, leçon 5 : « la file à valider est le vrai risque, pas la sécurité »), et il arrive par la
  porte que le lot 16 vient d'ouvrir. Mesuré, pas supposé ; non corrigé, aucun feu vert.

- **[P1] Le producteur de questions ne voit AUCUNE valeur, et ce n'est pas une précaution
  tiède.** Il reçoit le vocabulaire et, par prédicat, le nombre de faits VALIDÉS. Rien d'autre.
  Le corollaire est agréable : pas de déchiffrement, pas de niveau à arbitrer, pas de N2 à
  autoriser, rien à baliser — la surface d'injection est nulle parce qu'aucun texte écrit par
  quelqu'un d'autre n'entre dans ce prompt. Ce qui est `propose` mais pas validé n'y entre pas
  non plus : sa place est `/a-valider`, et ce producteur comble les TROUS plutôt que de doubler
  la file.
- **[P1] Deux déclencheurs, et ils ne font PAS la même chose.** Le chat lit UNE conversation
  (`apprendreDeLaConversation`) ; le cron fait une passe complète (jusqu'à dix conversations,
  plus les questions). Lancer une passe complète à chaque tour de chat coûterait le budget d'une
  journée en une soirée — la borne n'est pas dans le budget, elle est dans le choix de fonction.
- **[P1] Une passe DIT toujours pourquoi elle s'arrête.** Six motifs distincts, et un test
  exige qu'aucun n'en répète un autre. C'est la leçon que DriveAI a payée le matin même : son
  étape d'envoi vers la Mémoire sortait sur son garde-temps sans écrire une ligne, et « rien à
  faire », « jamais atteinte » et « budget épuisé » avaient le même symptôme — le silence.
- **[P1] Le gel, la base absente et la clé absente rendent `200`, pas `500`.** Un planificateur
  qui rougit tous les jours pour une intégration simplement éteinte apprend à être ignoré ; le
  motif, lui, est dans la réponse.
- **🟡 [P2] Une file de questions déjà pleine ne déclenche AUCUN appel.** Poser au-dessus du
  plafond écarterait une question que Marc n'a pas encore lue : payer un appel pour faire
  disparaître une question est le contraire du but. Prouvé par le COMPTEUR d'appels du faux
  modèle, jamais par un `posees: 0` — un appel raté rendrait zéro lui aussi.
- **🟠 [P1] Les dépenses ANTÉRIEURES au 16/09 valent toutes `chat`, par défaut de colonne.**
  C'est une approximation ASSUMÉE : avant cette date, les extractions lancées au bouton passaient
  par le même compteur, sans rien qui permette de les distinguer après coup. L'apprentissage est
  donc sous-compté sur le passé — borné, et dit plutôt que masqué.

## Découvert en chemin (lot 14)

- **[P1] La 3D a été ÉCARTÉE par Marc, le 16/09, et l'ADR 0002 §5.3 est donc amendé sur ce
  point.** Ce qu'il a retenu : un graphe 2D en SVG, zéro dépendance, dans le vocabulaire visuel
  existant. La raison qui a emporté la décision : à ~100 faits et quelques dizaines de liens,
  une 3D est MOINS lisible qu'un plan — elle sert quand la densité dépasse ce qu'un plan peut
  montrer, et on n'y est pas. Ce qu'on évite au passage : 1 Mo de dépendance runtime à auditer
  chaque semaine, et une CSP à rouvrir.
- **[P1] Pas de simulation de forces, et c'est un choix.** Un layout à forces est joli et NON
  DÉTERMINISTE : deux affichages du même graphe donnent deux images, rien ne se teste, et Marc
  ne peut pas dire « le nœud en haut à gauche » deux fois de suite. Les nœuds sont posés sur un
  CERCLE, groupés par domaine, dans un ordre total (degré, puis identifiant) — la position d'un
  fait ne bouge que si la mémoire change.
- **🔴 [P1] Une mutation qui ne discrimine pas n'accuse pas toujours le test — mais celle-là,
  oui.** Retirer le départage par identifiant à degré égal laissait onze cas verts : dans
  l'étoile de mon test, l'ordre d'entrée des feuilles ÉTAIT déjà celui de leurs identifiants,
  et le tri de V8 est stable. Les deux règles donnaient le même résultat. Il fallait un cas où
  les deux ordres DIVERGENT et où la coupe tombe entre deux nœuds de même degré — c'est là, et
  là seulement, que le départage décide qui est dessiné. Le trou était dans le TEST ; il est
  fermé, et la mutation rougit maintenant.
- **[P2] Un fait sans aucun lien n'est pas dessiné**, et il est COMPTÉ. Il n'apprend rien dans
  un graphe et éloignerait les nœuds qui, eux, se parlent. Ce que le dessin omet est dit dans
  la phrase qui l'accompagne : une image qui tait ce qu'elle laisse dehors se présente comme
  complète.
- **[P2] Le type d'un lien se lit au TRAIT, pas à la couleur.** Cinq couleurs demanderaient une
  légende et tomberaient sur le premier daltonisme. L'épaisseur dit le poids (ce que la règle
  vaut), le pointillé dit « coïncidence de dates » plutôt que « rapport établi ».
- **[P2] `tests/couleurs.test.ts` est né de ce lot** : un dessin est l'endroit où une couleur
  en dur se glisse le plus naturellement (« juste ce trait-là »), et une couleur figée est
  INVISIBLE à la relecture — parfaitement lisible dans le thème pour lequel on l'a écrite,
  fausse dans l'autre (BatchChef : 21 sites, zéro test rouge, c'est Marc qui l'a vu sur son
  téléphone). Deux exceptions NOMMÉES, jamais un dossier exclu : la page de consentement OAuth
  (du HTML autonome, sans feuille de style de l'app) et la couleur d'identité publiée au hub
  (une DONNÉE du contrat, pas un style). Un troisième cas garde la liste vivante : une
  exception dont le fichier a disparu, ou qui n'a plus de couleur, fait échouer le test.

## Découvert en chemin (lot 13)

- **🔴 [P1] LA 3D N'EST PAS LIVRÉE, ET C'EST UNE QUESTION POUR MARC.** L'ADR 0002 §5.3 et sa
  question D disent « une page `/graphe` 3D, chargée à la demande ». Ce qui EST livré : la
  table, les cinq règles, le recalcul, et une page qui montre les liens groupés par type avec
  **la phrase qui dit pourquoi chacun existe**. Ce qui manque : le rendu 3D — il demande une
  dépendance runtime (≈ 1 Mo, `three` plus un moteur de forces) ET un choix visuel, et Marc a
  posé « ne fais pas de choix de style sans mon accord ». Les deux se décident ensemble, pas en
  passant. ⚠️ **Rien de ce qui est livré ne serait jeté** : un rendu lirait la même table et
  les mêmes règles.
- **[P1] Une règle de liaison est QUADRATIQUE, et ça se borne ou ça noie l'écran.** Huit faits
  qui partagent un émetteur font 28 liens, quarante en font 780. Les règles de groupe
  s'ABSTIENNENT au-delà de `TAILLE_MAX_GROUPE` (8), et l'abstention est **comptée, nommée et
  affichée** : un graphe amputé en silence se présenterait comme un graphe complet. C'est la
  même règle que « une donnée illisible se COMPTE, elle ne se rabat pas sur zéro ».
- **[P1] Normaliser l'ordre d'une paire ORIENTÉE l'INVERSE.** `remplacement` va du nouveau vers
  l'ancien, `cause-declaree` du fait vers sa question ; les trois autres sont symétriques et
  leur paire DOIT être normalisée, sinon la même paire entre deux fois selon l'ordre de
  parcours. Une seule liste (`REGLES_ORIENTEES`) porte la distinction — et le test qui la garde
  choisit exprès un id de « nouveau » postérieur à celui de l'ancien : avec n'importe quelle
  autre paire d'ids, la mutation serait passée inaperçue.
- **[P2] `meme-periode` est bornée aux domaines DIFFÉRENTS**, et ce n'est pas une optimisation :
  l'exemple de l'ADR est « un emploi et un logement de la même année ». Deux faits du même
  domaine qui se chevauchent sont le cas ordinaire — les lier noierait les rapprochements qui
  surprennent, c'est-à-dire les seuls qui apprennent quelque chose.
- **[P2] La page dit l'ÉCART** entre ce qui est enregistré et ce que les règles donnent
  aujourd'hui. La table est une PHOTO du dernier recalcul, les faits bougent. Sans cet écart, un
  graphe de la semaine dernière se présenterait comme à jour — la classe de défaut que le hub a
  payée avec `dataAsOf`.
- **[P2] Un fait ILLISIBLE est écarté du calcul, pas rendu vide.** Deux faits illisibles auraient
  tous deux une valeur « » : les garder les grouperait ENSEMBLE et fabriquerait un lien entre
  deux faits sans le moindre rapport. Ils sont comptés et l'écran le dit.
- **[P3]** Le build émet un avertissement PRÉEXISTANT, sans rapport avec ce lot : `jose`
  (dépendance d'Auth.js) utilise `CompressionStream` dans le runtime Edge du middleware. Aucun
  effet observé — la session se déchiffre depuis le lot 1. À regarder si le middleware se met un
  jour à échouer sans message.

## Découvert en chemin (lot 12)

- **🔴 [P1] « Un invité voit un 403 lisible » était FAUX, et rien ne le disait.** Le refus d'un
  invité se décide au callback `jwt` (`auth.ts` rend `null` pour toute adresse autre que le
  propriétaire), donc `isAuthenticated` est faux au middleware et la règle ordinaire REDIRIGE
  vers `/login` → le hub → `frame-ancestors 'none'`. Dans une iframe, ça ne donne pas une page
  de connexion : ça donne un **rectangle blanc**, sans erreur, sans explication — et le `catch
  (NonAutorise)` de la page n'était jamais atteint. Corrigé par `ROUTES_CADREES`
  (`lib/authGuard.ts`) : pour `/widget` seul, le refus reste sur place et la page l'explique.
  ⚠️ Ce que ça coûte, dit en clair : la sécurité de cette page repose ENTIÈREMENT sur son
  `requireSession()`. Le matcher du middleware, lui, n'a pas bougé — ce n'est pas une
  exclusion, c'est une décision nommée et testée dans les deux sens (retirer la règle, ou la
  passer en préfixe, font rougir deux tests différents).
- **[P1] L'ORDRE des règles d'en-têtes est la garde, et il ne se relit pas dans la config.**
  Next applique la PREMIÈRE règle qui matche pour une clé : `/widget` après `/:path*`
  hériterait de `frame-ancestors 'none'`, et l'iframe resterait blanche sans rien de rouge
  nulle part. `tests/entetes.test.ts` a été ÉTENDU (pas re-basé) : il affirmait « une seule
  règle, et c'est `/:path*` », il affirme maintenant le FAIT — le fourre-tout couvre tout, les
  exceptions sont nommées, et celle du widget passe avant.
- **[P2] `X-Frame-Options` est RETIRÉ sur `/widget`, pas assoupli.** Sa valeur `ALLOW-FROM` est
  morte dans tous les navigateurs modernes : il n'existe aucune façon d'y écrire « seulement le
  hub ». Le laisser à `DENY` ferait échouer l'iframe en silence là où l'ancien en-tête est
  préféré. C'est `frame-ancestors` qui garde, et lui seul sait le faire.
- **[P2] Un périmètre absent ⇒ le widget ne montre RIEN, à l'inverse du contrat d'écriture.**
  Un jeton d'écriture est posé par Marc dans Vercel, avec intention ; une iframe est embarquée
  par du CODE d'app. Si l'absence de réglage voulait dire « tout », ajouter une iframe dans
  JobAI ouvrirait la mémoire entière sans que Marc ait rien décidé.
- **[P3] Une mutation qui ne discrimine pas n'accuse pas toujours le test.** Retirer le
  court-circuit `if (p.domaines.length === 0) return []` de `filtrerPourWidget` laissait tout
  vert : c'est de la REDONDANCE (le `Set` vide rejette déjà tout), pas un test faible. Écrit
  dans le code à côté de la ligne, plutôt que caché — et le vrai court-circuit, celui de la
  page (ne pas lire ni déchiffrer pour jeter ensuite), a reçu sa garde à lui.

## Découvert en chemin (lot 11)

- **🔴 [P1] `perimetres` était LUE et jamais ÉCRITE.** `depotFaits.perimetre()` la consulte
  avant chaque écriture depuis le lot 3 ; aucune page ne la remplissait. Un champ lu par le
  moteur sans producteur — la classe de défaut que l'écosystème a payée plusieurs fois. Le
  repli était SAIN (pas de ligne ⇒ le jeton décide seul), donc rien ne rougissait, et le
  périmètre restait inutilisable. Le widget (lot 12) en dépend entièrement.
- **[P1] Le chantier A reste à faire CÔTÉ DRIVEAI**, et il demande son propre ADR là-bas
  (« ce qui SORT du compte Google de Marc se tranche par un ADR », DriveAI CLAUDE.md §9). Côté
  MemoryAI, tout est prêt : `POST /api/faits`, le jeton `MEMORYAI_TOKEN_DRIVEAI_ECRITURE`, les
  fiabilités de DriveAI déjà déclarées, et maintenant son périmètre réglable.
- **[P2]** `Number("")` vaut ZÉRO, et zéro est un niveau valide : un champ ABSENT se lisait
  « niveau 0 ». Sans dégât (c'est le plus restrictif) mais silencieux — un réglage qu'on n'a
  pas fait ne doit pas s'écrire comme un réglage fait.

## Découvert en chemin (lot 10)

- **[P1]** La frontière des conversations passe entre LIRE et ÉCRIRE, pas entre « le MCP » et
  « le reste » : claude.ai est l'une des trois sources de l'ADR, il DOIT pouvoir écrire. La
  garantie n'est donc plus la liste d'imports (qui s'allonge à chaque point de câblage) mais le
  TYPE — `ContexteOutils.conversations` est un `Pick<…, "demarrer" | "consigner" | "parId">`,
  et un outil qui voudrait rendre un contenu ne compilerait pas.
- **[P2]** Le hook `Stop` vit dans `~/.claude/settings.json`, hors de ce dépôt : Marc veut
  TOUTES ses sessions, pas seulement celles de MemoryAI. C'est donc un geste à lui, décrit
  dans `HANDOVER.md` — aucune session Claude ne peut l'écrire.
- **[P3]** Le script tolère une transcription TRONQUÉE (une ligne illisible est comptée, pas
  fatale) : un arrêt brutal de Claude Code est le cas normal, pas l'exception.

## Découvert en chemin (lot 9)

- **[P1]** L'extraction est un GESTE de Marc, pas un automatisme : un appel payant sous le
  plafond du chat, et une extraction automatique remplirait `/a-valider` d'un coup — ce que le
  lot 7 existe pour éviter.
- **[P2]** La garde de frontière des conversations était une LISTE de fichiers autorisés ;
  elle a rougi au premier fichier légitime du lot 9. Convertie en RÈGLE (`lib/conversations/`,
  `app/conversations/`, la route du chat) avec son anti-vacuité : une liste s'allonge par
  réflexe, une règle oblige à se demander si le fichier a sa place dans le périmètre.
- **[P3]** `extraite_jusqua` est un RANG, jamais un drapeau : une conversation qui continue
  redevient extractible, et un booléen l'aurait figée à sa première passe.

## Découvert en chemin (lot 8)

- **[P1]** Le scan de secrets est une HEURISTIQUE et le restera. Ce qui le rend acceptable :
  les conversations ne sortent vers aucune app, et Marc peut en oublier une. Ce qui le
  rendrait inacceptable : les servir à un lecteur tiers. À relire si un widget devait un jour
  les montrer.
- **[P1]** Un SHA-1 de commit (40 caractères hexadécimaux) est MASQUÉ par le scan. C'est
  délibéré : on ne peut pas le distinguer d'une clé hexadécimale de façon fiable, et
  l'asymétrie des coûts tranche pour le masquage. Si ça devient bruyant, la sortie est une
  liste d'exemptions NOMMÉES, jamais un assouplissement du prédicat.
- **[P2]** `lib/fuseau.ts` est né de ce lot : `America/Toronto` vivait en dur dans
  `lib/coutChat.ts`. Un test interdit désormais tout fuseau recopié, et tout
  `Intl.DateTimeFormat` sans `timeZone: FUSEAU`.
- **[P3]** La consignation est en « au mieux » : un échec d'écriture ne fait PAS échouer le
  tour de chat (Marc a eu sa réponse ; la perdre serait pire). L'échec est journalisé côté
  serveur — il n'apparaît nulle part dans l'interface.

## Découvert en chemin (lot 7)

- **[P1]** `ResultatLot` porte désormais `idsCrees` — la page de questions doit lier la
  réponse de Marc au fait qu'elle vient de créer, et l'empreinte est un HMAC keyé qui ne se
  recalcule pas côté page. ⚠️ `POST /api/faits` PROJETTE maintenant les quatre champs du
  contrat au lieu de rendre l'objet interne : sans ça, le contrat public s'élargissait au
  premier champ ajouté, en silence. Verrouillé par un scan de source avec son anti-vacuité.
- **[P2]** `nettoyerTexte` (ex-`nettoyer`, privée) est exportée de `lib/validerFait.ts` : une
  question posée par un modèle est du texte exactement comme une valeur de fait, et la règle
  ne doit exister qu'une fois.
- **[P3]** Dans un fichier `"use server"`, exporter un OBJET casse le build à la collecte des
  pages — après le typecheck et les tests. Le pendant de la leçon JobAI (là-bas, un export de
  trop ouvre une route).

## Découvert en chemin (lot 6)

- **[P1]** Le seed a été composé depuis les cinq MCP et le Drive ; deux lectures n'ont pas
  abouti (bail de logement : OCR illisible, `lire_document` en dépassement de délai) — les
  dates du bail sont proposées à confiance 0,5 et à relire sur le document. Un scan
  de passeport a été classé par DriveAI sous le mauvais émetteur d'après l'OCR (à corriger
  côté DriveAI).
- **[P2]** `/a-valider` valide un fait à la fois : 105 faits, 105 gestes. Une validation en
  lot (« tout valider dans ce domaine ») est la première chose que Marc demandera.
- **[V2]** Prédicats qu'il a fallu contourner faute d'existence en v1 : `vehicule.ancien` (un
  ancien véhicule assuré jusqu'à une date passée), `emploi.lieu` (la ville), `identite.citoyennete`.
  Comptés ici plutôt qu'écrits en `predicat_inconnu` : le seed ne passe pas par la route
  avant l'envoi.

## Mise en service (15/09, soir) — mesuré, pas supposé

- **[P1]** L'app est en ligne : domaine posé, `/moi` `/a-valider` `/chat` en `200`, session du
  hub déchiffrée. Restent trois gestes de Marc : envoyer le seed, poser `HUB_TOKEN_MEMORYAI`
  côté hub, brancher le connecteur dans claude.ai.
- **[P2]** Une session Claude ne peut PAS joindre `memoryai.hubperso.com` (403 au CONNECT du
  proxy, mesuré deux fois). Elle ne peut donc ni envoyer le seed ni tester l'app : le canal qui
  reste est les journaux runtime de Vercel, qui suffisent au diagnostic.
- **[P1]** Le seed est envoyé : trois lots (50/50/5), trois `POST /api/faits` en `200` le
  15/09 à 20:44, zéro refus. Reste la validation dans `/a-valider`.
- **[P1]** `/hub/summary` est passé en `500` à la première VRAIE donnée (98 faits, plus de
  huit domaines) : plafond du contrat à 8 items, code à 12. Corrigé avec agrégation de la
  queue. Classe de défaut à surveiller ailleurs : un plafond de contrat qu'on recopie au
  lieu de le dériver, et qu'aucune fixture n'atteint.
- **[P1]** Le branchement de claude.ai a buté sur NOTRE CSP (`form-action`), pas sur le
  connecteur : corrigé, avec son test. C'est la dernière marche du flux OAuth, et elle
  échouait en silence.
- **[P2]** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` n'ont aucun usage ici (`providers: []`).
  Si elles traînent dans le projet Vercel, ce sont deux secrets à faire tourner le jour d'une
  fuite pour zéro service rendu.

## Phase 1 — ADR 0002 (accepté par Marc le 15/09)

Le plan fait foi dans l'ADR 0002 §8. Ici, l'état.

| Lot | Contenu | État |
|---|---|---|
| 7 | Page de questions : table, plafond de 5 ouvertes, réponse ⇒ fait, l'écran | ✅ 15/09 |
| 8 | Conversations : tables, chiffrement AAD, scan de secrets, chat branché, `/conversations`, oubli | ✅ 15/09 |
| 9 | Extraction `conversation-v1` : une conversation propose des faits, `/a-valider` les reçoit | ✅ 15/09 |
| 10 | Les deux autres sources : outil MCP `memoryai_consigner`, `scripts/pousser-session.mjs` | ✅ 15/09 |
| 11 | Les périmètres deviennent ÉCRITS : `/apps`, `depotPerimetres`, une app ne décide plus seule | ✅ 15/09 |
| 12 | Widget `/widget` : périmètre, 403 lisible dans le cadre, CSP par route | ✅ 15/09 |
| 13 | Graphe : table `liens`, les cinq règles, `/graphe` | ✅ 15/09 |
| 14 | Le graphe se DESSINE : 2D en SVG, zéro dépendance | ✅ 16/09 — **décision de Marc** contre la 3D de l'ADR |
| — | Chantier A (DriveAI alimente) : **côté MemoryAI tout est prêt**, le reste est un ADR chez DriveAI | ✅ 16/09 — le canal transporte, 2 348 faits acceptés à la 1ʳᵉ passe |
| 15 | Auto-validation des faits MÉCANIQUES (ADR 0003) + rattrapage du stock en SQL | ✅ 16/09 |
| 16 | La mémoire APPREND seule : budget par poste, extraction déclenchée (chat + cron), producteur de questions | ✅ 16/09 — demandé par Marc le 16/09 |

⚠️ **Le lot 11 du tableau n'est pas celui que l'ADR annonçait.** L'ADR 0002 §8 y mettait le
chantier A ; en arrivant au lot 12 on a trouvé que `perimetres` n'était jamais écrite (voir
plus bas), et le widget en dépendait entièrement. Les périmètres ont donc pris la place, et le
chantier A est sorti de la numérotation — il n'est pas un lot de ce dépôt : c'est un ADR et du
code chez DriveAI. Le renuméroter en silence aurait fait croire à un lot sauté.

**L'ordre est celui que Marc a choisi le 15/09** : la page de questions d'abord, puis le
chantier A (ADR 0002 §4, question A). ⚠️ Le lot 10 porte une contrainte née de sa réponse à
la question C — Claude Code pousse automatiquement, donc le scan de secrets se livre AVANT le
hook, et une session dont le scan échoue n'est pas envoyée.

## Phase 3 — ADR 0005 (**ACCEPTÉ** — « go pour les lots L25-L32 », Marc, 18/09)

Le plan fait foi dans l'[ADR 0005 §8](docs/adr/0005-lia-parle-juste-et-l-interface-s-efface.md).
Trois chantiers, huit lots, chacun avec sa mesure et sa condition de mort. **Go donné le 18/09** — et les quatre décisions de l'ADR §9 sont posées à part.

⚠️ **Ce que la mesure dit au 17/09, 21 h UTC** : 8 onglets là où l'ADR 0004 n° 42 en décidait
4 ; un prompt de six lignes en dur et un balisage `<fait>` **sans lien vers la fiche** (Lia n'a
rien à citer pour un fait ordinaire) ; le profil de Marc (0004 §8) **jamais construit** ;
**99 faits** sur lui et **31 prédicats à zéro sur 96**.

### Chantier A — Lia parle juste

✅ **[L25a] L'ÉVICTION PAR LA FENÊTRE — livré le 18/09.** Découvert en voulant mesurer le
  risque n° 1 du §7 de l'ADR (« une valeur ambiguë reçoit tous ses liens, mesuré sur les 99
  faits réels ») : `memoryai_contexte` ne servait que **2 faits sur 99**. Cause : `faits()`
  lisait `limite: 500` ordonné par `desc(creeLe)` sans filtrer `migreEnPiece`, et les ~2 729
  papiers migrés saturaient la fenêtre. Correctif : `conditionServis()`, source unique
  consommée par `faits()` ET `comptes()`. Plus : le compteur `retenus` de la quarantaine,
  calculé puis jeté, remonte désormais au modèle (`noteEcartes`). *Mesure* : 7 gardes,
  perturbation à **2 rouges sur 7** (les deux bons). Leçons en `CLAUDE.md` §9 n° 5, 6 et 7.

✅ **[L25b] LA GARANTIE DES LIENS — livré le 18/09.** `lib/chat/liens.ts` (pur, 3 passes),
  `ref="/fait/<id>"` au balisage, `ResultatOutil.faitsServis` à la place d'`idsFaits`, la
  couche RÈGLES dans le prompt, et le rendu segmenté (lien + marque) avec son CSS.
  *Mesure* : 24 gardes, **3 perturbations indépendantes** → 2, 1 et 1 rouge, aux bons
  endroits. typecheck, lint et build verts.
  ⚠️ **Reste à vérifier par Marc** : le rendu du lien à l'écran, dans un vrai tour de chat.
  Il exige une session connectée, une clé API et un appel de modèle — le build attrape le
  JSX et le CSS, il ne dit rien de ce qui s'affiche.
  ⚠️ **Ce que L25 ne couvre PAS, et ce n'est pas un oubli** : les « faits liés » sur la
  fiche `/fait/[id]`. L'ADR les place en **L30** (« un point s'ouvre en fiche, avec ses
  faits liés »), où vivent les cinq règles du graphe. La fiche porte déjà valeur,
  provenance, date, statut et confiance par `CarteFait detail`.

✅ **[L25c] LES LIENS DE DOCUMENTS — livré le 18/09, signalé par Marc.** « j'ai pas les
  liens pour les documents ». Cause mesurée : un fait `ref_document` porte un fileId opaque
  en valeur, donc l'appariement ne pouvait pas tirer ; le libellé humain est dans
  `attributs.type`. Correctif : `FaitServi.etiquette` (le libellé) + `FaitServi.lien` (le
  Drive), une citation qui offre la FICHE **et** le PAPIER, et la validation des liens
  inventés. *Mesure* : 31 gardes, 3 perturbations → 1, 2 et 1 rouge.
  ⚠️ La 1re perturbation ne rougissait RIEN au départ : 30 gardes appelaient le module avec
  une entrée fabriquée à la main. Leçon en `CLAUDE.md` §9 n° 10.

- [ ] **[L25] Les liens, garantis** — `ref` dans le balisage `<fait>` (`/fait/<id>` ou Drive),
  post-traitement **déterministe** côté serveur qui relie chaque valeur servie à sa source et
  marque « (non sourcé) » / « (déduit) » ce qui ne l'est pas, fiche `/fait/[id]` enrichie
  (provenance, date, statut, faits liés). Les `propose` sont servis, **marqués « (à confirmer) »** par le
  post-traitement (décision de Marc du 17/09, contre la reco). *Mesure* : 0/20 affirmations
  sur Marc sans lien ni marque, sur les 10 questions du socle + 10 libres. *Meurt si* > 2/20
  après deux corrections. ⚠️ Valeur ambiguë (deux faits, même valeur) ⇒ **tous** les liens.
- [~] **[L27] Lia** — *livré le 16/10/2026 (MemoryAI#101) : profil, voix éditable, trois couches ; RESTE : la voix **apprise** par l'extracteur et le sélecteur de modèle.* Le **profil de Marc** (0004 §8, jamais construit) : fonction PURE depuis
  les faits validés N0/N1 hors quarantaine, borné à 1 500 caractères, injecté balisé
  `<profil>` comme DONNÉE ; la **voix éditable** dans Régler (texte libre N0, 600 caractères,
  `nettoyerTexte`, balisée comme donnée) **ET apprise** : l'extracteur relève ce que Marc dit
  de la manière dont on lui parle → `preference.communication` en `propose` → validé → la voix
  s'en dérive par une fonction pure (jamais un modèle qui écrit dans le prompt) ; le prompt en **trois couches** (voix / profil /
  règles) dont seules les règles sont fixes et gardées par test ; le nom **Lia** partout sauf
  dans un fait. Sonnet 5 par défaut, Opus au sélecteur. *Mesure* : Marc change la voix une
  fois et le constate au tour suivant ; il ne se réexplique plus sur un point en base.
  *Meurt si* il ne touche jamais la voix en un mois, ou redit deux fois la même chose en
  trois semaines. Dépend de L25.
- [ ] **[L31] Lia cherche avant de répondre** — la stratégie dans les règles (facettes puis
  recherche, familles de graphies, `memoryai_contexte` par domaine avant « je ne sais pas »,
  papiers ET faits) ; outil neuf **`memoryai_conversations_chercher`** (résumé par date).
  *Mesure* : la question n° 9 du socle (« qu'est-ce qu'on avait conclu le 16 ? ») trouve sa
  réponse. Dépend de L25, L27.

### Chantier D — Lia lit tout, et ça se surveille

Demande de Marc, 18/09 : « je veux que ce soit lia qui lise tous mes fichiers et qui commence
à grandir, je veux aussi une sorte de base de donnée avec toutes les infos et cest avec cette
base de donnée quon va faire un graph à un moment. dans le futur je voudrai aussi pouvoir
faire la recherche avec une ia toute simple limite sur telephone donc que la recherche soit
simple, la puissance des autres modeles sera surtout pour comprendre ce que je veux et mettre
du contexte ou autre. »

⚠️⚠️ **Mesuré avant de cadrer, et deux de ses trois points sont DÉJÀ BÂTIS** :
- **La base « avec toutes les infos » existe** : la table `pieces` porte les facettes
  *keyées* (type, émetteur, titulaire, domaine, langue, année — filtrables **sans
  déchiffrer**), les dates du document et d'échéance, un résumé, `champsStructures`
  (numéros, montants, personnes, lieux) et `champsLibres`, dont le commentaire dit
  littéralement « c'est ici, et seulement ici, que *je veux tout* vit sans vocabulaire ».
  Le graphe s'en nourrit déjà (`liens` + les cinq règles).
- **La recherche simple aussi** : `to_tsvector('french', recherche)` + facettes keyées. Du
  Postgres, **aucun modèle pour trouver** — un téléphone peut interroger ça. La contrainte
  que Marc énonce est déjà l'architecture.
- **Ce qui manque est le DÉBIT** : **83 papiers lus sur 2 728** (mesuré en direct le 18/09 ;
  2 645 sont des noms de fichiers jamais ouverts). Et la LECTURE vit dans **DriveAI** — ce
  dépôt reçoit (`POST /api/pieces`, 50 par lot, idempotent), il n'extrait pas.

- [x] **[L34] Dépenses & import** — livré le 18/09. Quatrième onglet, demandé explicitement
  (« jveux pouvoir choisir dans lapp je veux aussi un onglet dédié aux depenses a limport »).
  Les plafonds deviennent **réglables par Marc** (table `plafonds`, migration 0015), la page
  montre la dépense du jour par poste, le total et le coût MOYEN par appel (la seule grandeur
  qui serve à estimer la suite), et **où en est la lecture** (lus / non lus par extracteur).
  ⚠️ Ce qui reste verrouillé de l'ADR 0001 §5.5 (« plafond dur, NON DÉSACTIVABLE ») : un
  plafond EXISTE toujours (absence = défaut du 16/09, jamais « illimité »), il est toujours
  CONSULTÉ (`budgetOuvert` le prend en argument REQUIS — `tsc` a énuméré les cinq sites), et
  il est BORNÉ par le code ET par la base. Ce qui est interdit là-bas est de l'ÉTEINDRE, pas
  d'en choisir la valeur — et le test de la somme disait lui-même que relever un poste oblige
  à « rouvrir le total avec Marc, ce qui est une décision de dépense ». Il l'a prise.
- [x] ⚠⚠ **[L39] UNE PIÈCE DÉJÀ EN BASE N'EST JAMAIS RÉÉCRITE — donc lire un document que
  l'inventaire connaît est un NO-OP.** — **LIVRÉ le 18/09** (ADR 0006 + `depot.remplacer`,
  verdict dans `ecrireLotPieces`, compteur `remplacees` publié par `POST /api/pieces`,
  6 gardes dans `tests/remplacerPiece.test.ts`, chacune vue rougir sur sa perturbation).
  ⚠️ **`L36` N'EST PLUS BLOQUÉ.**
  ⚠⚠ **Et l'ALARME de ce ticket était FAUSSE, mesurée à la livraison** : « la recherche ne
  porte que sur 83 papiers, une colonne `recherche` nulle ne matche rien » — or
  `validerPiece` **DÉRIVE** `recherche` du type et de l'émetteur, que la migration pose. Un
  papier d'inventaire EST donc trouvable, par son **étiquette** ; ce qui manquait est son
  **contenu**. Le défaut était exact, son alarme non (voir ADR 0006 §1.1, corrigé). Trouvé par la revue de L38, vérifié dans le code :
  `empreintePiece(cle, sujet, fileId)` identifie le **DOCUMENT**, pas la lecture ; et
  `lib/pieces/ecrire.ts` fait `dejaPresentes += 1; continue;` sur collision, sans aucun
  `UPDATE` — son en-tête le dit en toutes lettres : « une pièce déjà écrite est
  `dejaPresentes`, **jamais dupliquée ni réécrite** ».
  ⚠️⚠️ **Conséquence : les ~2 645 papiers de l'inventaire ne peuvent PAS devenir « lus » par
  le chemin d'écriture actuel.** DriveAI peut ouvrir le document, appeler un modèle, payer
  l'appel et poster la pièce : même `sujet`, même `fileId` ⇒ même empreinte ⇒ ligne intacte,
  `extracteur` toujours `moteur-inventaire-v1`. L'argent part, rien ne change.
  ⚠️ ~~**Ce ticket BLOQUE `L36`**~~ — levé le 18/09. Il l'a bloqué parce qu'une boucle écrite
  avant lui aurait été INERTE en production tout en dépensant —
  `CORRECTIF-VERT-EN-TEST-INERTE-EN-PROD` dans sa forme la plus coûteuse. Et ça explique peut-être le **83 lus sur 2 728** : ces 83 seraient
  les documents SANS ligne d'inventaire antérieure. *À mesurer sur la prod* :
  `SELECT extracteur, count(*), min(cree_le), max(cree_le) FROM pieces GROUP BY extracteur`,
  et croiser les `file_id` de l'inventaire avec ce que DriveAI dit avoir extrait.
  ⚠️ **L'idempotence n'est PAS le défaut** : refuser un double POST est juste. Ce qui manque
  est la distinction entre « la même pièce repostée » (à refuser) et « la même pièce ENRICHIE
  par une vraie lecture » (à accepter). Ça touche le **contrat d'écriture** → **ADR avant le
  code** (§11), et deux choses sont à trancher par Marc : qu'est-ce qui autorise un
  remplacement (l'extracteur seul ? une confiance supérieure ?), et que devient l'ancienne
  ligne (remplacée, ou gardée comme une correction de fait l'est ?).
- [ ] **[L40] Une garde de RATIO de contraste, pour les prochaines couleurs** — `[L38]` en a
  écrit une (`tests/contraste.test.ts`) : conversion OKLCH→sRGB, ancrée sur deux références
  CONNUES (blanc/noir = 21:1, l'exemple canonique de WCAG `#767676` sur blanc = 4,54:1), et
  elle asserte le SEUIL et non la valeur — épingler « 4,02:1 » se ferait re-baser au premier
  ajustement. Reste à ÉTENDRE sa table aux paires des autres écrans : elle ne couvre
  aujourd'hui que les quatre paires des graphes. *Mesure* : chaque paire texte/fond du dépôt
  est dans la table, ou explicitement exemptée avec sa raison.
- [x] **[L35] La file de lecture, par valeur d'émetteur** — **LIVRÉ le 18/09** (ADR 0007 :
  `GET/POST /api/pieces/file`, table `lectures_tentees`, 22 tests, dix perturbations rouges).
  ⚠️ L'idempotence de la lecture vit désormais DANS LA MÉMOIRE : un papier lu sort de la file
  tout seul ([L39]), un papier qui ne donne rien en sort par un VERDICT (par extracteur).
  Ordre choisi par Marc le 18/09.
  MemoryAI sait ce qui vaut d'être lu (il a les facettes) ; il doit l'EXPOSER pour que DriveAI
  demande « qu'est-ce que je lis ensuite ? ». Haut de file : Revenu Québec, Banque Aurore, Crédit du Lac,
  Préfecture, École Delta, Zenith, Alphatech. ⚠️ **L'export Facebook (166 papiers) en DERNIER**,
  décision de Marc : « Fichier HTML », « Fichier de configuration », « Export données »,
  tous du même jour — c'est l'échafaudage d'un dump, pas de la vie de Marc. *Mesure* : la
  file rend d'abord des émetteurs nommés, jamais Facebook tant qu'il reste autre chose.
- [ ] **[L36] La boucle de lecture dans DriveAI** — **autre dépôt**. Il a les fichiers et
  l'extracteur (`haiku-4.5-piece-v1`, qui marche : Revenu Québec, Banque Aurore, Crédit du Lac, Préfecture
  ressortent proprement). Il lui manque de tourner à l'ÉCHELLE, en demandant sa file à L35 et
  en s'arrêtant au plafond que Marc a réglé. Dépend de L34 et L35.
- [ ] **[L37] ADR — la recherche reste SIMPLE** — verrouiller par écrit ce qui est déjà vrai :
  la recherche est du Postgres (plein texte français + facettes keyées), **aucun modèle n'est
  requis pour TROUVER** ; les gros modèles traduisent l'intention en requête et mettent du
  contexte. ⚠️ Sans décision écrite, quelqu'un ajoutera des embeddings dans six mois « pour
  améliorer la recherche » — et la contrainte de Marc (« une ia toute simple, limite sur
  telephone ») mourra sans que personne ne l'ait décidé.

### Chantier B — L'interface s'efface

- [x] **[L26a] La barre passe de HUIT à TROIS onglets** — **Parler** (l'accueil EST la
  conversation ; les compteurs quittent la tête de page), **Chercher** (`/pieces`), **Régler**
  (nouvelle page : cinq sections REPLIÉES — État, À valider, Conversations, Apps, Liens —
  chacune portant le chiffre qui dit s'il y a quelque chose à y faire). `/chat` REDIRIGE vers
  la racine plutôt que de tomber en 404. Livré le 18/09, PR à venir dans ce lot.
  ⚠️ **TROIS, pas quatre, et c'est mesuré** : **Voir** demande la frise et les échéances à
  90 jours, et **aucune requête d'échéances n'existe dans ce dépôt** (zéro fonction).
  ⚠️ Précision mesurée le 18/09, contre la donnée RÉELLE, et elle change le coût de L30 : la
  DONNÉE existe déjà — l'attribut `echeance` (une des quatre clés de `CLES_ATTRIBUTS`) **et**
  des prédicats dédiés (`projet.echeance`, `formation.echeance`), dont au moins un porte un
  fait valide dans la mémoire de Marc. Ce qui manque est la REQUÊTE (« les échéances des 90
  prochains jours, triées »), pas la matière. Une première rédaction disait « seule la clé
  d'attribut existe » : vrai des attributs, faux des prédicats.
  Un onglet qui ne mène nulle part coûte un clic pour
  apprendre qu'il n'y a rien — il arrive avec **L30**, qui le construit. La mesure du lot est
  « ≤ 2 clics sur les 10 questions du socle », pas « exactement quatre entrées ».
  ⚠️ Les anciennes clés de `Nav` sont GARDÉES et traduites en section à un seul endroit
  (`SECTION_DE`) : faire muter les huit pages dans le même lot aurait mêlé le déplacement de
  la NAVIGATION à la réécriture des PAGES. Gardes : `tests/navSections.test.ts` (chaque
  entrée mène à une page qui EXISTE ; aucune page ne disparaît de la barre en silence).
- [x] **[L33a] La fiche d'un fait — affichage et rattachements** — demande de Marc du 18/09
  (« full retravailler comment ça affiche les faits et ce qu'on en fait »), cadrée en QCM le
  même jour. Livré : la valeur et la PHRASE en tête, le vocabulaire machine sous un dépli
  « D'où ça vient » ; un papier porte son TYPE en titre au lieu de son fileId Drive (le cas
  MAJORITAIRE : ~2 729 faits sur ~2 828) ; le document d'où le fait vient, les autres faits
  tirés du même document, les faits LIÉS avec leur `pourquoi`, et « demander à Lia là-dessus ».
  ⚠️ Réponse en TEXTE LIBRE de Marc — « voir le document lié, ou tous les documents liés » —
  qu'aucune de mes options n'anticipait : 4ᵉ fois que le texte libre apprend ce qu'un menu
  bornait. Mesuré : `provenances.source_ref` était ÉCRIT et INDEXÉ, et jeté par
  `rendreLisible` — la demande était à un CHAMP de distance, pas à une requête neuve.
  ⚠️ Rejeter / Oublier restent VISIBLES : Marc n'a pas coché « les replier ».
- [x] **[L33b] Corriger un fait** — livré le 18/09. Un champ sur la fiche, sous un dépli :
  écrire la bonne valeur, la valider ; l'ancienne est GARDÉE, marquée `perime` (« remplacée
  par un plus récent », **jamais** `rejete` — elle était vraie à sa date).
  ⚠️⚠️ **J'annonçais un ADR, et la mesure l'a rendu inutile** : aucune frontière n'est
  déplacée. `ecrireLot(…, MARC, …)` est le chemin par lequel Marc écrit depuis le lot des
  questions, et `admin.valider` PÈRIME déjà tout seul les autres faits validés du même
  prédicat non `multi` (écrit et commenté dans son corps). Corriger = écrire et valider.
  L'ADR aurait délibéré sur une décision déjà prise par le schéma ; le vrai risque était
  d'inventer un chemin d'écriture parallèle à côté de celui qui marche.
  ⚠️ Seul geste AJOUTÉ : `depotAdmin.perimer` — sur un prédicat `multi`, `valider` ne périme
  RIEN, donc sans lui la « correction » AJOUTE une valeur au lieu de remplacer la mauvaise.
  Invisible sur un prédicat simple, c'est-à-dire sur la plupart.
  ⚠️ Un `ref_document` est REFUSÉ explicitement : sa valeur est un fileId Drive, la retaper
  casserait le seul lien fiable du papier. La fiabilité d'une correction est **marc**, pas
  celle du document corrigé. Et chaque refus rend sa CAUSE (union discriminée), parce qu'un
  refus muet ferait repartir Marc en croyant sa mémoire à jour.
- [ ] **[L33d] `remplaceId` n'a AUCUN producteur** — mesuré le 18/09 : il est LU (la règle de
  graphe `remplacement`, la ligne « remplace … » de la fiche) et écrit **par personne** en
  production ; seules des fixtures de test le posent. Donc la règle de liaison
  `remplacement` **ne peut pas tirer**, et la ligne de la fiche est inatteignable — un
  `UN-CHAMP-TYPE-SANS-PRODUCTEUR` vieux de plusieurs lots. Lui donner un producteur exige de
  l'ajouter au **contrat d'écriture** (`validerFait.ts`), ce qui EST une frontière : **ADR
  avant le code** (§11). C'est L33b qui fournirait son premier producteur naturel (une
  correction remplace), et la section « Faits liés » de la fiche l'afficherait gratuitement.
  *Mesure* : la règle `remplacement` produit au moins un lien sur une correction réelle.
- [ ] **[L33c] Les papiers en masse** — L33a répare la FICHE d'un papier ; la liste de
  `/pieces` et les résultats de recherche ont leur propre habillage, non touché. Recenser
  avant de coder (mesurer, pas supposer) quelles surfaces affichent encore un fileId.

- [x] **[L26b] Régler fusionne l'ÉTAT** — livré le 18/09. Les compteurs, les dépenses (par
  poste ET depuis le début), la répartition par domaine et le vocabulaire s'affichent EN
  PLACE dans Régler → État ; `/moi` ne porte plus que la purge.
  ⚠️ **Le périmètre écrit ici par L26a était FAUX, et c'est moi qui l'avais écrit** :
  « 16 actions serveur » comptait aussi celles de `/questions`, `/chat` et `/pieces`, qui ne
  sont pas dans Régler. Recensé sur les cinq pages : **12**, dont **7 pour la seule file**.
  ⚠️ **État était presque gratuit** : `/regler` FETCHAIT déjà **3 des 5** lectures de `/moi`
  pour n'en afficher qu'un compteur (manquaient la dépense TOTALE et le vocabulaire).
  ⚠️ Première rédaction : « 4 des 5 » — chiffre écrit SANS mesure, recompté par la revue.
  ⚠️ **La fusion a cassé quelque chose que rien n'aurait dit** : dix Server Actions
  invalidaient `/moi` parce que les compteurs y vivaient ; les déplacer n'a pas déplacé les
  dix listes (mesuré : 10 sites sur `/moi`, **zéro** sur `/regler`). Invisible côté serveur
  — les pages sont `force-dynamic` — et visible en navigation CLIENT, où Next sert le payload
  RSC en cache. Corrigé par une **source unique** (`app/rafraichirCompteurs.ts`), pas par dix
  corrections. Gardes : `tests/reglerFusion.test.ts`, 6 perturbations → une rouge chacune.
- [x] **[L26b-manifeste] L'app INSTALLÉE ouvrait la page de purge** — trouvé par le panel,
  APRÈS un gate vert et la PR ouverte. `app/manifest.ts` portait `start_url: "/moi"`, ce qui
  avait un sens quand `/moi` était l'accueil fonctionnel. Après L26a (l'accueil devient la
  conversation) et surtout L26b (`/moi` ne porte plus QUE la purge), lancer l'app installée
  plaçait Marc droit devant « Effacer toute la mémoire ». ⚠️ Et `tests/partage.test.ts`
  ÉPINGLAIT `"/moi"` : la garde **CERTIFIAIT** la valeur périmée au lieu de l'attraper.
  Corrigé en **dérivant** `start_url` de `SECTIONS[0].href` — un manifeste, personne ne le
  relit ; l'assertion est inversée en place avec son histoire.
- [x] **[L26b-accueil] Personne n'invalidait l'accueil** — aussi trouvé par le panel. Le
  bandeau « Lia a N questions » est un agrégat, et **aucune** Server Action n'invalidait
  `"/"`, pas même celles qui répondent à une question. ⚠️ Et le recensement a montré que le
  trou était plus large : **SIX** pages lisent un compteur agrégé, la source unique en
  connaissait DEUX. La liste est désormais **dérivée du code par le test**, dans les deux
  sens (rien d'oublié, rien de fantôme) — une liste écrite à la main est exactement ce qui
  venait de pourrir.
- [ ] **[L26b2] Régler fusionne APPS** — le prochain candidat, et le dernier qui en vaille la
  peine : une seule lecture (`depot.tous()`), du contenu de CONFIGURATION (pas du contenu
  personnel), deux actions à déplacer (`regler`, `retirer`). *Mesure* : les périmètres se
  lisent et se règlent sans quitter Régler.
- [x] **[L26b3] La voix de Lia dans Régler** — fait le 16/10/2026 avec L27 (MemoryAI#101) : section « Comment Lia te parle » dans `/regler`.

  ⚠️⚠️ **Trois fusions ont été DÉCIDÉES CONTRE, avec leur raison — elles ne sont pas des
  restes à faire** :
  - **Conversations : NON**, et c'est une mesure. Un `<details>` masque à l'œil mais
    **expédie son contenu** : le HTML est rendu, replié ou non. Inliner la liste mettrait
    les résumés de conversations dans la source de Régler à CHAQUE chargement, alors
    qu'aujourd'hui ils ne sont lus que si Marc va les voir. **Un repli est une commodité
    d'affichage, jamais une frontière de données.**
  - **La purge : NON**, et pour la raison inverse. Le ticket demande « purge plus
    difficile » ; la mettre dans un dépli du hub la rendrait plus FACILE. Elle garde sa page
    (`/moi`), atteinte par un lien qui dit ce qu'elle fait.
  - **À valider : NON.** C'est un plan de travail (7 des 12 actions), pas un panneau. Et
    **Liens** non plus, mais pour une autre raison : `L26c` le RETIRE après `L30`.
- [ ] **[L26c] Le graphe est retiré** — page, SVG, disposition et leurs tests ;
  `lib/graphe.ts`, la table `liens` et le recalcul RESTENT. ⚠️ **Reporté délibérément de
  L26a** : le dessin est aujourd'hui le seul endroit où l'on VOIT ce que les cinq règles
  produisent, et son remplaçant est la **frise de L30**. Le retirer avant elle enlèverait
  une surface sans la remplacer (« une épuration se juge sur ce qu'elle ne doit pas
  emporter »). Dépend de L30.
- [ ] **[L26d] Les `hint` de vingt lignes deviennent un « ? »** — non touché par L26a, qui
  n'a déplacé que la navigation. Recenser les `hint` réellement longs (mesurer, pas
  supposer) avant d'en faire une surface repliée.
- [ ] **[L29] Chercher** — une barre ; résultats **groupés par émetteur** (0004 n° 29) ;
  facettes cliquables ; familles de graphies regroupées visuellement (lot 24) ; papiers ET
  faits ; un résultat s'ouvre en fiche. *Mesure* : questions 1, 4, 8 du socle en ≤ 2 clics.
  Dépend de L26a.
- [ ] **[L30] Voir — la frise** — trois bandes (0004 n° 50 : vie · documents · conversations)
  sur un axe ; échéances à 90 jours en tête ; un point s'ouvre en fiche avec ses **faits
  liés** (les cinq règles du graphe, en liste). Rendu serveur, SVG sans JavaScript comme le
  graphe l'était, déterministe. *Mesure* : question n° 6 du socle répondue à l'écran.
  Dépend de L26a.

### Chantier C — Toutes les infos possibles sur lui

- [~] **[L28] Les questions qui comblent** — *livré le 16/10/2026 (MemoryAI#102) en texte libre : `lib/questions/combler.ts`, branché dans la passe d'apprentissage, santé, famille, goûts d'abord, dans les places libres du plafond de cinq. RESTE : le **QCM** (une option de QCM pointe aujourd'hui vers un fait existant ; combler veut créer le fait) et la **mesure à 30 jours** (≤ 10 prédicats à zéro).* Un producteur **sans modèle** (même dessin que
  les contradictions) : pour chaque prédicat à zéro, une question en texte libre, ou en QCM
  quand les valeurs se devinent (langue, statut, fuseau). Priorité : santé, famille, goûts,
  puis le reste. Plafond de cinq inchangé, renouvelé à chaque réveil. *Mesure* : ≤ 10
  prédicats à zéro à 30 jours (31 aujourd'hui). *Meurt si* Marc écarte plus qu'il ne répond.
- [ ] **[L32] L'import de ce qu'il a déjà écrit** — script du dépôt qui lit ses neuf
  `CLAUDE.md` et sa mémoire Claude Code, propose des `preference.*` / `projet.*` en fiabilité
  `marc`, **proposés — Marc les valide dans la file** (sa décision du 17/09 : ses `CLAUDE.md`
  portent des choses périmées qu'il veut voir passer). *Mesure* : ≥ 40 faits neufs validés.
- ⬜ **[C3-C5]** — le hook Claude Code, le flux vivant des pièces, un domaine à contenu servi,
  puis Gmail : **gestes de Marc**, dans `docs/A_FAIRE_MOI.md`.

*Mesure du chantier* : de **99** à **≥ 300** faits validés sur Marc en 30 jours.

### Ordre

**L25 et L26 en parallèle** (ils ne se touchent pas), puis **L27** dès que L25 est mesuré,
puis L28, puis L29 + L30, puis L31, puis L32. Les mesures A et B se rejouent sur les **10
questions du socle** — elles existaient avant ce plan, c'est ce qui les rend honnêtes.

### Les quatre décisions — tranchées par Marc le 17/09 (ADR 0005 §9)

- [x] Graphe : **retiré**.
- [x] Voix de Lia : **« éditable, mais apprend en continu »** — réponse libre, hors des deux
  options. A4 réécrit : la voix se dérive AUSSI des `preference.communication` validés, appris
  par l'extraction et validés par Marc — jamais écrits directement dans le prompt.
- [x] Faits non validés : **servis, marqués « (à confirmer) »** (contre la reco). A2 simplifié.
- [x] Import des `CLAUDE.md` : **proposés, à valider** (contre la reco). L32 passe par la file.

⚠️ Deux réponses sur quatre ont divergé de la recommandation, et une était libre. Noté ici
parce que c'est la deuxième fois dans ce dépôt (la 3D du graphe, le 16/09) : une
recommandation rend le choix rapide, elle ne le pré-décide pas.

**Attend le Go de Marc sur l'ensemble** avant que L25 et L26 démarrent.

## Phase 2 — ADR 0004 (**accepté** par Marc le 16/09)

Le plan fait foi dans l'**ADR 0004 §10**. Ici, l'état et la mesure de chaque lot.

⚠️ **Chaque lot porte sa MESURE et sa condition de MORT** (décision de Marc, 16/09 : « chaque
lot porte sa mesure, et meurt s'il rate »). Un lot qui rate sa mesure est **retiré**, pas
rafistolé. C'est le prix du « projet permanent » : sans critère d'arrêt, on construit sans fin
ce qui ne sert pas.

⚠️ **Rien ne part dans un autre dépôt avant que le socle soit prouvé** (décision n° 57), à une
exception : DriveAI doit écrire son propre ADR pour envoyer le CONTENU des documents — c'est
un **prérequis** du socle, pas une suite.

### Lot 17 — LE SOCLE (le seul engagé)

| | |
|---|---|
| Contenu | Table `pieces` · extraction de **100 documents seulement** · recherche facettes + plein texte français · outils MCP · migration des 2 729 `document.existe` · PWA installable + partage Android |
| Mesure | (a) les 100 pièces jugées correctes par une passe de contrôle **et** (b) **8 des 10 questions** de l'ADR 0004 §10 trouvent leur réponse |
| Meurt si | moins de 8 sur 10 après deux corrections ⇒ **on ne lance pas les 19 900** |
| État | 🟦 en cours (16/09) |

- ✅ **[S1]** Table `pieces` + `piece_exemplaires` (migration `0009`), le RÉGIME de
  chiffrement qui décide de ce qui reste en clair, **et la migration des `document.existe`
  en pièces** (`0012`, `lib/pieces/migration.ts` + `migrerInventaire.ts`) — 16/09. Du CODE et
  pas du SQL, parce que la valeur est chiffrée sous l'AAD `id|niveau` : seul le code peut la
  déchiffrer puis la re-sceller sous l'identifiant de la PIÈCE.
  ⚠️ **Rien n'est effacé, dans aucun sens.** Le fait reste, marqué `migre_en_piece` — il cesse
  simplement d'être SERVI ; la pièce porte `origine_fait_id`, ce qui rend le retour en arrière
  EXACT (il ne supprime que ce que la migration a créé). Les pièces s'écrivent D'ABORD, les
  faits se marquent ENSUITE : une coupure entre les deux rejoue, l'ordre inverse perdrait des
  papiers en les déclarant migrés avant de les avoir écrits.
  ⚠️ **Par LOTS de 50, déclenchés par Marc**, et les PLUS ANCIENS d'abord : `document.existe`
  est réalimenté en continu par le tick de DriveAI, donc partir du plus récent laisserait le
  vieux stock stagner pendant que le neuf passe devant (la leçon que DriveAI a payée deux fois
  sur ses files mouvantes). Neuf mutations ; deux étaient MUETTES au premier jet — marquer le
  lot ENTIER, y compris les faits dont la pièce a été refusée (un papier perdu des DEUX tables,
  le pire mode d'échec possible), et l'ordre FIFO, que le test ne mesurait pas.
  ⚠️ **Le producteur est livré avec** (`/a-valider`, deux Server Actions) et **gardé** : un test
  dérive les fonctions exportées du module et exige que chacune soit appelée depuis `app/`.
  Sans lui, tout ce lot serait vert, réversible, prouvé — et ne tournerait jamais
  (`UN-CHAMP-TYPE-SANS-PRODUCTEUR`, plus discret sur une fonction que sur un champ).
- ✅ **[S2]** Contrat d'écriture des pièces (`lib/pieces/validerPiece.ts`) : bornes, canari
  qui marque sans refuser, refus des balises de rôle, régime appliqué au point d'écriture.
- ⏸️ **[S3]** Extraction Haiku 4.5 une passe, 100 documents **stratifiés** — **BLOQUÉ par
  DriveAI** : le contenu des documents ne sort pas encore de son compte Google. L'ADR-0061
  y est accepté, les lots C49-1 à C49-4 ne sont pas démarrés.
- ✅ **[S4]** Recherche — 16/09. Facettes keyées, index `to_tsvector('french', …)`, dépôt de
  lecture (`lib/pieces/depotLecture.ts`) et **deux outils MCP** : `memoryai_papiers_facettes`
  (les valeurs CONNUES avec leur nombre — sans elles le modèle devine « Banque Aurore » contre
  « Banque Aurore Assurances générales » et conclut qu'il n'y a rien) et
  `memoryai_papiers_chercher`. Sept mutations sur la lecture, quatre sur les outils.
  ⚠️ **Trois sorts, et aucun n'est le silence** : complète · sommaire (N3 — le domaine et les
  DATES, jamais le type ni l'émetteur, qui disent le statut migratoire) · retenue (N2 sans la
  bascule), et ce qui ne sort pas est COMPTÉ dans la réponse.
  ⚠️ Le plein texte ne voit que le régime EN CLAIR ; une pièce chiffrée se retrouve par ses
  FACETTES. C'est le dessin, pas une lacune — et c'est dit au modèle dans la description.
- ✅ **[S5]** Quarantaine du vocabulaire (ADR 0004 §2.3) — 16/09. Un prédicat neuf n'est plus
  REFUSÉ : il entre, il est cherchable, et il n'est **jamais servi à un modèle** tant qu'il n'est
  pas sorti de quarantaine (Marc d'un clic sur `/a-valider`, ou trois extracteurs DISTINCTS).
  `refuse` est ABSORBANT — le volume n'annule pas une décision de Marc. Huit mutations jouées,
  chacune ne rougissant que ce qu'elle vise ; deux étaient MUETTES au premier jet (le test MCP
  était satisfait par la bascule N2 et non par la quarantaine ; les fixtures employaient des
  `gout.*` qui EXISTENT déjà dans le vocabulaire).
  ⚠️ Élargi dans le même lot : `REFUS_STRUCTURELS` ne refusait `position` qu'en TÊTE de prédicat —
  `logement.position` n'était donc refusé que parce que le vocabulaire était FERMÉ. L'ouvrir
  retirait ce filet (leçon « rendre une fonction plus permissive DÉSARME les gardes aval »).
- ✅ **[S6]** PWA installable + cible de partage Android — 16/09. Manifeste, icônes, service
  worker, `/partage`, et le brouillon repris par `/chat`. Dix mutations.
  ⚠️ **Aucun FICHIER n'est accepté au partage**, et c'est une décision : partager un document
  ici ferait ingérer un papier par MemoryAI, or c'est le travail de DriveAI et c'est par lui
  que passe la frontière de l'ADR-0061. Un second chemin d'entrée serait une source de vérité
  que personne ne penserait à fermer le jour d'un retrait.
  ⚠️ **Le texte partagé ne passe JAMAIS par l'URL** (historique, journaux de proxy, `Referer`) :
  Cache Storage → `sessionStorage`, et il est consommé UNE fois.
  ⚠️ Le piège de BatchChef est repris tel quel : le worker n'intercepte que `mode === "navigate"`,
  sinon il avale les Server Actions de la page et rend un 303 à leur place — journaux serveur
  vides, diagnostic à l'aveugle.
  ⚠️ **Les icônes sont des aplats de couleur**, pas un dessin. Elles rendent l'app installable
  aujourd'hui ; les remplacer est un geste de Marc, pas un lot.
- ✅ **[S7]** Les 10 questions de test (`lib/questionsTest.ts`), figées AVANT [S3], validées
  par Marc telles quelles. ⚠️ Le seuil codé est **strict** : huit sur dix ET la n° 5, celle
  qui teste la capacité neuve. Le tableau ci-dessus n'écrit que « 8 des 10 » ; c'est l'ADR
  §10 qui fait foi, et `verdictSocle` le porte.
- ⬜ **[S8]** Jeton dédié vers FinanceAI (lecture des montants, jamais de copie)

⚠️ **Arbitrage de Marc, 16/09 — deux régimes de chiffrement.** L'ADR promet à la fois « les
numéros vivront chiffrés » (§2.1) et « plein texte français natif de Postgres » (§7), ce qui
ne peut pas être vrai du même champ. Marc a choisi deux régimes selon le niveau, contre la
recommandation « tout chiffré, plein texte après filtrage ». Trois verrous rendent ce choix
tenable, et ils ne se négocient pas : le niveau vient du CODE (un extracteur ne peut que le
MONTER), un dossier inconnu tombe du côté chiffré, et une pièce qui monte en niveau se
RÉÉCRIT — le clair est irréversible jusque dans les sauvegardes.

⚠️ **Bug préexistant, découvert en chemin (non corrigé — hors périmètre).** Les migrations
`0007` et `0008` ont été écrites à la main sans leur `meta/NNNN_snapshot.json` ; `0009` suit
le même chemin. Conséquence : un futur `drizzle-kit generate` comparerait le schéma au
snapshot `0006` et proposerait de recréer des colonnes qui existent déjà — le SQL généré
serait à relire ligne par ligne avant d'être appliqué (leçon JobAI, vécue).

### Non engagés — l'ordre choisi par Marc

| Vague | Contenu | Mesure de mort | Dépend de |
|---|---|---|---|
| Campagne | Les 19 900 documents, Haiku par lots dans **GitHub Actions**, plafond dur + contrôle qualité aux 500 + bouton d'annulation | taux d'erreur qui monte au contrôle ⇒ arrêt automatique | socle **prouvé** |
| A | **Le modèle de Marc** : construction, injection par app, verrous d'injection | Marc doit encore se réexpliquer après 3 semaines ⇒ retiré | socle |
| B | **Les échéances** : chaînage des dates, carte du hub, 3 à 5 lignes | il ne clique jamais dessus ⇒ retiré | campagne |
| C | **Gmail** : filtre « ce qui porte un fait » d'abord, extraction ensuite | le filtre laisse passer plus de 20 % de bruit ⇒ on ne branche pas | campagne |
| D | Conversations : cherchables, résumées, décisions extraites, frise | — | A |
| E | Interface : 4 onglets (Chercher · Voir · Parler · Régler), accueil, frise à 3 bandes | — | B |
| F | Widgets dans les 5 apps | un widget vide dans 3 apps sur 5 après un mois ⇒ retirés | E |
| G | **Le graphe 3D** avec zoom et liens par modèle | Marc n'y trouve rien qu'il ne trouvait ailleurs ⇒ reste une page, pas un chantier | D, E |

### Tranché en séance, à ne pas rouvrir

- **[P1] Ollama sur la RTX est ÉCARTÉ** — Vercel et Apps Script ne peuvent pas joindre un
  service qui tourne chez Marc (son PC n'a pas d'adresse joignable). La seule forme qui
  marcherait exige un service Windows à demeure, contre sa règle « ne jamais avoir à lancer
  une commande sur mon PC ». Si des embeddings deviennent nécessaires, ils seront **en ligne**.
  *(Remplace le `[P3]` ci-dessous, qui proposait exactement ça.)*
- **[P1] Pas d'embeddings tant que la mesure ne les réclame pas.** On compte pendant deux
  semaines les questions qui échouent **parce que les mots diffèrent alors que le sens est le
  même**. Sans ce compte, on construit un mécanisme pour un besoin supposé.
- **[P1] Le travail LONG ne tourne pas sur Vercel** : GitHub Actions (jusqu'à 6 h, déjà dans
  le parc). ⚠️ Le contenu des documents transite alors par un runner GitHub — dit ici plutôt
  que découvert en chemin.
- **[P2] Le graphe est une phase à part, jamais dans le socle.** 20 000 points en 3D sur un
  téléphone, c'est du niveau de détail, ~1 Mo de dépendance et une CSP à rouvrir.

### Contradictions portées, à trancher à la maquette

- **[P1]** Décision n° 39 (« les trois empilés » sur l'accueil) contre n° 41 (« épuré, une
  chose à la fois »). Piste : un accueil qui ne montre qu'une chose à la fois mais laisse
  glisser entre les trois. **À trancher en voyant, pas en discutant.**
- **[P1]** Décision n° 31 (« rien à l'écran, la source au clic ») : tant que personne ne
  clique, un fait deviné et un contrat signé se lisent pareil. À re-mesurer une fois que des
  faits devinés existeront vraiment.

## Reporté (phase 1)

- **[P2]** Remonter dans `app-template` : widget, CSP, squelette MCP.
- ~~**[P3]** Rattrapage du stock sur le PC (Ollama sur la RTX 5080 ou Haiku 4.5)~~ — **caduque** :
  remplacé par la campagne GitHub Actions + Haiku de l'ADR 0004. Ollama écarté, voir ci-dessus.
- **[V2]** Vocabulaire v2 depuis les prédicats refusés comptés en v1 — **absorbé** par la
  quarantaine de l'ADR 0004 §2.3 : le vocabulaire grandit désormais tout seul.

## Audit de remédiation du 2026-09-18 — lot L2 (chaîne de CI)

| Lot | Contenu | État |
|---|---|---|
| L2a | `persist-credentials` explicite sur les 2 étapes `actions/checkout` | ✅ 18/09 |
| L2b | `npm ci --ignore-scripts` sur les 2 installs de workflow | ✅ 18/09, mesuré |
| L2c | `npm install -g` non épinglé, action tierce non épinglée au SHA | ✅ sans objet — ce dépôt n'a ni l'un ni l'autre (mesuré : seules `actions/checkout` et `actions/setup-node` sont employées) |

- **Recensement rejoué** après coup, ancré sur la FORME d'une étape (`uses: actions/checkout`)
  et non sur la mention : **2 étapes, 2 déclarations, 2 `--ignore-scripts`**. ⚠️ Un `grep` nu
  sur-compte, parce que le commentaire qui explique le correctif NOMME l'action.
- ⚠️ **Ce que `--ignore-scripts` obligeait à vérifier ici** : `@mokarade/hub-contract` est une
  dépendance **git**, et son `dist/` n'existe que parce que son script `prepare` le construit à
  l'installation. Mesuré cache npm VIDE compris : `dist/` est bien livré — npm construit une
  dépendance git au moment de la RÉCUPÉRER, pas au moment d'exécuter les scripts d'install.
  Gate complet vert (typecheck, lint, tests, build). À re-mesurer si npm change de majeure.
- **[P2]** À remonter dans `app-template` avec le reste (widget, CSP, squelette MCP) : ce
  `ci.yml` est le squelette des futures apps, donc ce qui manque ici manque à chaque fork.
