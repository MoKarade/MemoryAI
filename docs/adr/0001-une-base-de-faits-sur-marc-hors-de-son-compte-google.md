# ADR 0001 — Une base de faits sur Marc existe hors de son compte Google

- **Statut** : **accepté** (Marc, 15/09/2026 — « go », sans réserve sur les 21 décisions ;
  l'hypothèse de la Q13 reste telle qu'écrite tant qu'il ne la corrige pas). Proposé le même
  jour par la session Claude ; aucune ligne de code de la phase 0 n'a été écrite avant cet
  OK — c'est le protocole de l'écosystème (DriveAI CLAUDE.md §9 : « ce qui SORT du compte
  Google de Marc se tranche par un ADR », et COMPTE-RENDU §7 : plan court + OK avant de coder).
- **Portée** : ce dépôt (`MemoryAI`, `memoryai.hubperso.com`). Ce qu'il exige des autres
  dépôts est nommé en §6 ; chacun le livrera par son propre ADR au moment de sa phase.
- **Amont** : DriveAI ADR-0059 (cadrage de l'assistant transversal, accepté le 15/09) et le
  brief de démarrage « Mémoire — phase 0 ». Cet ADR en est la déclinaison **côté MemoryAI** :
  il fige ce que le brief laissait à figer ici (contrat d'écriture, vocabulaire, niveaux) et
  consigne les réponses de Marc du 15/09 aux 21 questions de cadrage.

## 1. Contexte

Marc, 15/09/2026, mot pour mot : « je veux que mon assistant devienne 1000x plus intelligent,
qu'il lise au fur et à mesure tous les documents sur moi […] qu'il ait genre une base de
données […] connecté à toutes les infos sur toutes mes apps […] et dès que dans n'importe
quelle app j'utilise un assistant, j'aimerais que ce soit cet assistant […] et secure au max. »

Aujourd'hui, l'assistant transversal de fait est claude.ai : il a les connecteurs Gmail, Drive
et Calendar de Marc, plus cinq serveurs MCP (DriveAI, FinanceAI, JobAI, CarAI, BatchChef). Ce
qui lui manque n'est pas un ACCÈS, c'est une **mémoire** — un endroit où « mon bail finit le
14 juillet 2030 » survit à la conversation — et un **journal** de ce qui a été lu, par qui.

L'écosystème s'est interdit cette mémoire treize fois, par écrit (DriveAI ADR-0059, annexe
critique §3). La plus frontale : DriveAI ADR-0007, « le texte des documents ne sort que vers
l'API Anthropic pour le classement ; il ne se stocke nulle part ». Deux tentatives antérieures
ont été retirées : le « prêt de jetons » du hub (Hubperso ADR 0001 §3) et la mémoire « Era »
de FinanceAI, tuée par une injection de prompt.

## 2. La frontière franchie, nommée

**Des FAITS TYPÉS sur Marc, dérivés de ses documents, de ses mails et de ses apps, sont
persistés dans une base Neon (Postgres) hébergée hors de son compte Google, et servis à des
lecteurs qui ne sont pas Marc lui-même (claude.ai, un chat, plus tard un widget dans chaque
app).**

Ce qui NE franchit PAS la frontière, et un test échoue si on le réintroduit :

- aucun texte source (corps de document, corps de mail, extrait) — un fait est une valeur
  ≤ 200 caractères et un **pointeur** (`fileId`, SHA-256 d'un `messageId`) ;
- aucun montant, jamais (`valeur_type: "montant"` ⇒ 422) — FinanceAI reste la source des
  chiffres, DriveAI publie « ce qui existe et où, jamais combien » (ADR-0045) ;
- aucune valeur de niveau 3 (identité, immigration, fiscal) — seulement
  `{ existe, type, date, échéance, ref_document }` ;
- aucune position GPS, aucune adresse de tiers, aucun numéro d'identité (prédicats refusés
  structurellement) ;
- aucun jeton : ni Google, ni d'app. **Ce sont les apps qui détiennent un jeton vers
  MemoryAI**, jamais l'inverse (patron `HUB_TOKEN` du hub, inversé).

## 3. Les garde-fous obtenus en échange

| Menace | Garde-fou | Où il se vérifie |
|---|---|---|
| Injection par les faits (ce qui a tué Era) | À l'écriture : Zod strict, vocabulaire fermé, ≤ 200 car., refus des URL / retours à la ligne / balises, drapeau `canari` (impératif, « ignore », « système » ⇒ jamais servi, visible dans « à valider »), `fiabilite_source` et `statut` **déduits du jeton**. À la lecture : chaque fait rendu en résultat d'outil, balisé `<fait id fiabilite statut>`, **jamais dans un prompt système** | `validerFait()` PURE + corpus adversarial (~30 pièges) en CI dès la phase 0, prouvé par mutation |
| Fuite de la base ou des variables | AES-256-GCM applicatif dès N1, clé `MEMORYAI_CHIFFREMENT` en env Vercel, nonce par ligne, **AAD = `id\|niveau`** (rétrograder un fait pour le lire fait échouer le déchiffrement) ; N3 sans valeur ; montants inexistants ; aucun jeton à voler | tests de chiffrement, dont « AAD altéré ⇒ échec » |
| Invité d'une app hôte | MemoryAI est une app **sans invités, jamais** : `lib/accesHub.ts` supprimé, propriétaire seul | test de non-réintroduction |
| Jeton d'app fuité | un jeton = une app = un rôle (lecture OU écriture) = un périmètre étroit ; jeton inconnu ⇒ périmètre VIDE, pas une erreur bavarde | test « jeton inconnu ⇒ rien » |
| Session hub volée (cookie 30 j, `AUTH_SECRET` partagé par 5 apps — MemoryAI en devient le 6ᵉ détenteur) | N3 inexistant ; N2 servi sur bascule **journalisée et par conversation** (retombe à OFF) ; alerte « plus de N faits révélés dans la journée » ; rotation coordonnée documentée | `acces_journal` append-only, HMAC chaîné, 1 an |
| Le modèle abaisse un niveau | `niveau = MAX(ce que le code dérive, ce que le LLM propose)` — jamais le minimum | `validerFait()` |
| Un fait oublié qui revient | table `oublis` (hash source_ref\|predicat\|sujet), consultée **avant toute insertion, sur tous les chemins** | test « oublié ⇒ refusé au rejeu » |
| Kill-switches | `MEMORYAI_GEL=1` ⇒ 503 sur MCP, `/api/contexte`, `/api/faits`, chat (l'UI reste lisible) ; rotation d'un jeton = changer une variable ; retirer la clé de chiffrement = 503 fermé ; purge totale par saisie du mot `SUPPRIMER` | phase 0-1 |

## 4. Décisions de Marc — 15/09/2026, 21 questions

Les quatre décisions du brief (app neuve, tout le stock lu sur le PC, Takeout + moteur pour
les mails, adresse servie à périmètre) sont **acquises** et ne se rouvrent pas ici.

| # | Question | Décision | Conséquence |
|---|---|---|---|
| 1 | Nom | **`memoryai` partout** — `memoryai.hubperso.com`, `app.id = "memoryai"`, variables `MEMORYAI_*`, outils MCP `memoryai_*`, affiché « MemoryAI » | le brief disait `memoire` ; ce dépôt, le projet Vercel (`memory-ai`) et cet ADR font foi |
| 2 | Base | **Neon, projet neuf**, créé par Marc — jamais le Neon du hub | en attendant `DATABASE_URL`, tout se code sur PGlite en tests |
| 3 | Vercel | projet `memory-ai` **créé par Marc** (vérifié : lié au dépôt, deux déploiements `READY` du commit initial) | il reste : le domaine `memoryai.hubperso.com`, les variables |
| 4 | Variables | Marc n'a encore **ni** `MEMORYAI_CHIFFREMENT`, **ni** les clés MCP, **ni** de clé Anthropic, **ni** de jeton d'app | `HANDOVER.md` porte la commande de génération de chacune ; rien ne se génère dans un commit |
| 5 | Rétention Anthropic | **inconnue** | le chat ne sert AUCUN fait N2 tant que `MEMORYAI_N2_CHAT=1` n'est pas posé — et Marc ne le pose qu'après avoir lu la console. Un réglage d'écran qui dit « vérifié » mentirait |
| 6 | Clé Anthropic | **dédiée** à MemoryAI | le coût publié au hub est celui de cette app, pas un mélange |
| 7 | Connexion | **`providers: []`**, la session vient du hub ; propriétaire seul | patron CarAI/JobAI ; `accesHub.ts` supprimé + test |
| 8 | Hub | PR Hubperso (`lib/sources.ts` + `HUB_TOKEN_MEMORYAI`) **dans la phase 0** | sinon l'app n'apparaît ni sur le hub ni dans `/administration` |
| 9 | Vocabulaire | **« encore plus, et de plus en plus »** | v1 LARGE (§5), versionnée ; les prédicats refusés sont COMPTÉS et affichés pour devenir la v2 — un 422 n'est pas une fin, c'est le signal qui dit quoi ajouter |
| 10 | Proches | **Marc seul** en phase 0 | le schéma prévoit `foyer:<slug>` / `entite:<slug>` mais aucun écrivain ne les produit ; test « sujet ≠ marc ⇒ 422 » |
| 11 | Adresse | bascule N2 **par conversation** | jamais un réglage permanent |
| 12 | Chat plein écran | **dans la phase 0** | minimal, un outil d'appel Anthropic, plafond dur 1 $/jour non désactivable |
| 13 | Modèle du chat | **sélecteur** « pour toutes les IA dispo » | lu : tous les modèles Anthropic accessibles à la clé (Haiku 4.5, Sonnet 5, Opus 5), défaut Sonnet 5, plafond commun. ⚠️ **Hypothèse** : « toutes les IA » = tous les modèles Anthropic — un autre fournisseur (OpenAI, Google, Ollama local) serait une décision à part, avec sa propre rétention à vérifier. À confirmer en une ligne |
| 14 | Outils MCP | `memoryai_*`, **« de plus en plus »** | `memoryai_contexte`, `memoryai_chercher`, `memoryai_proposer`, `memoryai_etat`, `memoryai_inventaire` en phase 0 ; un outil ajouté = une ligne dans le manifeste ET une décision écrite (c'est le contrat public) |
| 15 | Seed | **depuis cette session** (elle a les 5 MCP) | liste montrée à Marc AVANT tout envoi ; 80-150 faits ; il valide en lot dans `/a-valider` |
| 16 | DriveAI | **on n'y touche pas encore** ; toutes les apps seront modifiées ensuite | phase 0 = MemoryAI + une PR hub. `Memoire.gs` et les widgets viennent après, par ADR dans chaque dépôt |
| 17 | PC RTX 5080 | **allumé** | Ollama devient une option réelle pour le rattrapage (phase 3) — à mesurer sur 100 documents avant les 19 000 |
| 18 | Ordre | **ADR seul en PR brouillon, OK, puis code d'un trait** | cette PR |
| 19 | Merge | règle de `claude-config` : je fusionne moi-même ce qui est vert hors brouillon | un ADR « proposé » reste en brouillon jusqu'à l'OK |
| 20 | « Fini » pour la phase 0 | (a) dans claude.ai : « où est mon avis de cotisation 2024 ? » → lien Drive ; « quand finit mon bail ? » → un fait validé avec sa provenance ; **(b) + Marc valide des faits dans `/a-valider` depuis son téléphone** | le chat plein écran (Q12) est livré mais n'est pas la condition de fin |
| 21 | Interface | **mobile ET PC**, direction bento du hub | `globals.css` de Hubperso comme point de départ |

## 5. Ce qui est figé ici

### 5.1 Le contrat d'écriture — `POST /api/faits`

Repris du brief §6 tel quel (lot ≤ 50 faits, `Authorization: Bearer <MEMORYAI_TOKEN_<APP>>`,
réponse `{ recus, acceptes, refuses: [{ index, raison }] }`). Les huit règles que **le serveur
impose** — fiabilité et statut déduits du jeton, niveau calculé (MAX avec celui proposé),
montant ⇒ 422, prédicat inconnu ⇒ 422 avec le nom refusé, tout champ de contenu ⇒ 422 (liste
EXACTE des champs acceptés verrouillée par test), idempotence par
`(source_ref, predicat, sujet, version_extracteur)`, `oublis` avant insertion, refus nommés —
sont reprises sans changement. Ce qui s'ajoute (Q9) : **un prédicat refusé est compté**
(`predicats_refuses` : prédicat, appelant, nombre, dernière vue, version du vocabulaire), et
`/a-valider` affiche ces compteurs. Le nom d'un prédicat n'est pas une donnée personnelle ; sa
valeur, elle, n'est jamais stockée quand le prédicat est refusé.

### 5.2 Le vocabulaire — v1, large, versionné

Le brief proposait ~40 entrées ; Marc en veut « encore plus, et de plus en plus ». La v1 porte
donc **les onze familles du brief** (emploi, études, logement, véhicule, santé, relations,
identité / immigration / fiscal en N3, goûts, projets, documents, abonnements / existence
financière) **plus** : `voyage.*` (destination, dates, hébergement — N1), `loisir.*` (sport,
activité, équipement — N0), `famille.*` (événements datés : anniversaire, mariage — N2),
`animal.*` (N0), `contact.*` (existence d'un contact professionnel, N1, jamais ses
coordonnées), `formation.*` (cours suivis, certifications — N1), `garantie.*` (un achat sous
garantie et son échéance — N1), `contrat.*` (un contrat existe, son échéance, son fournisseur
— N1 ; internet, téléphone, assurance habitation). Ordre de grandeur : **~100 prédicats**, la
liste exacte vit dans `lib/vocabulaire/v1.ts` et son test.

Trois règles qui ne bougent pas quelle que soit la version :
1. **Le niveau minimal de chaque prédicat est écrit dans le vocabulaire**, pas déduit à
   l'exécution : un modèle propose un niveau, le code prend le MAX.
2. **La version du vocabulaire est stockée sur le fait ET sur le refus.** Sinon un prédicat
   refusé aujourd'hui l'est à vie, et la v2 n'aurait aucun effet rétroactif (DriveAI l'a payé
   sur ses règles de routage).
3. **Un prédicat ne se retire jamais d'une version** : il se marque `deprecie` avec son
   remplaçant. Les faits existants restent lisibles.

### 5.3 Les niveaux

| Niveau | Contenu | Lecteurs (phase 0) |
|---|---|---|
| N0 | goûts, préférences, projets, loisirs | en clair ; claude.ai, chat |
| N1 | employeur, études, véhicule, abonnements, voyages, contrats, existence d'un document | chiffré ; claude.ai, chat |
| N2 | domicile, santé, relations, famille, existence d'un fait financier | chiffré ; claude.ai et chat **sur bascule journalisée par conversation** — et seulement si `MEMORYAI_N2_CHAT=1` (Q5) |
| N3 | identité, immigration, fiscal | **aucune valeur stockée, même chiffrée** ; existence, type, date, échéance, pointeur |

### 5.4 Le modèle de données

Six tables du brief §5 (`faits`, `provenances`, `perimetres`, `oublis`, `acces_journal`,
`sujets`) plus `predicats_refuses` (§5.1). Neon + Drizzle, migrations appliquées **au
démarrage** (patron `jobai/lib/migrations.ts`) : Marc ne lance jamais une commande.

### 5.5 Le chat — modèles et plafond

- SDK Anthropic officiel, clé **dédiée** (`ANTHROPIC_API_KEY` de ce projet).
- Sélecteur de modèle (Q13) : `claude-haiku-4-5`, `claude-sonnet-5` (défaut), `claude-opus-5`.
  Pas de Fable 5.1 : ce modèle exige une rétention de 30 jours [Certain, doc API], ce qui
  contredit la condition de la Q5.
- **Plafond dur 1 $/jour, non désactivable**, compté au site d'appel AVANT toute validation
  de réponse (l'appel est facturé même si le schéma refuse ensuite — leçon JobAI). Coût publié
  au hub en `period: "total"`.
- Aucune conversation persistée : `sessionStorage` strict ; « Épingler » crée un fait
  `propose`.
- Les faits entrent dans le prompt **en résultat d'outil**, balisés, jamais en prompt système.

## 6. Ce que cet ADR exige des autres dépôts (plus tard, chacun par son ADR)

- **Hubperso** (phase 0, cette fois-ci) : une entrée `memoryai` dans `lib/sources.ts` et la
  variable `HUB_TOKEN_MEMORYAI`. Rien d'autre : le hub ne connaît aucune app en particulier.
- **DriveAI** (phase 1) : `Memoire.gs`, inventaire sans LLM, drapeau `MEMOIRE_PUSH` éteint
  par défaut, `privacy.test.js` étendu, test de la liste exacte des champs poussés.
- **JobAI, CarAI, BatchChef, FinanceAI, DriveAI app** (phase 2-3) : le widget, la CSP, un
  jeton chacun.
- **app-template** (phase 2) : ce que MemoryAI aura appris (widget, CSP, squelette MCP).

## 7. Ce que ça ne fait pas

Pas de table de refresh tokens. Pas de jeton Google. Pas de corps de mail dans Drive. Pas de
connecteur Gmail en tâche planifiée. Pas de tunnel vers le PC. Pas de conversation persistée.
Pas d'outil d'écriture vers une autre app depuis le chat avant une décision explicite. Pas
d'historique de repas. Pas de fait sur un tiers en phase 0. Jamais un montant.

## 8. Plan de la phase 0 — les lots, dans l'ordre

Chaque lot = une PR, gate vert (typecheck · lint · tests · build), fusionnée dès qu'elle est
verte et hors brouillon. Objectif prouvable : la Q20 (b).

| Lot | Contenu | Preuve |
|---|---|---|
| 0 | **Cet ADR** + identité `memoryai` + `vercel.json` (`claude/*` sans préversion) | Marc dit OK |
| 1 | Auth par le hub (`providers: []`, `accesHub.ts` supprimé + test), en-têtes de sécurité (CSP enforcée, HSTS), `MEMORYAI_GEL` | test de non-réintroduction ; `/login` renvoie au hub |
| 2 | Neon + schéma des 7 tables + migrations au démarrage + chiffrement (AAD) + journal chaîné | tests sur PGlite ; « AAD altéré ⇒ échec » |
| 3 | `validerFait()` PURE + vocabulaire v1 + `POST /api/faits` + `oublis` + corpus adversarial | mutation : retirer le balisage ⇒ CI rouge |
| 4 | MCP `memoryai` (5 outils) + OAuth porté de `carai/lib/mcp/oauth.ts` | claude.ai connecté, `memoryai_etat` répond |
| 5 | UI `/moi`, `/a-valider`, `/fait/[id]`, chat plein écran + sélecteur + plafond, `/hub/summary` en `building`, PR hub | Marc valide un fait depuis son téléphone |
| 6 | Seed : 80-150 faits proposés depuis cette session, montrés avant envoi | les deux questions de la Q20 répondues dans claude.ai |

Ce qui reste hors dépôt, à la charge de Marc, dans `HANDOVER.md` : le projet Neon, les
variables, le domaine, la rétention Anthropic, le connecteur dans claude.ai.

### Notes de mise en œuvre (lot 3, 15/09) — précisions, pas révisions

- **N3 = aucun contenu, pas « aucune valeur »** : un fait N3 porte une date (échéance) ou un
  pointeur (`ref_document`) en `valeur`, jamais un texte — c'est la liste du §5.3. Contrainte
  SQL `faits_n3_sans_texte` + refus `n3_texte` dans `validerFait`, même quand c'est le dossier
  DriveAI qui a monté le niveau.
- **`attributs`** (type, émetteur, année, échéance — liste fermée, chiffrée dès N1) : les
  métadonnées d'un document, pour répondre « où est mon avis de cotisation 2024 ».
- **La fiabilité est un plafond par jeton** (`lib/jetons.ts`) : le corps peut déclarer plus
  bas, jamais plus haut ; un `source_type: "mail"` force `mail-tiers`.
- **Une valeur qui ressemble à une consigne n'est pas refusée** : elle est écrite `canari`,
  jamais servie, et la réponse ne le dit pas à l'écrivain.
- **Un prédicat mal formé n'est pas compté** (seul un nom bien formé entre dans
  `predicats_refuses`) — rien de refusé n'est stocké.

## 9. Risques, dits une fois

1. **La file « à valider » est le vrai risque du projet** (brief §10.1). Mesurée dès le lot 5
   ; alerte au-delà de 100, forte au-delà de 500. Un fait `propose` issu d'un document classé
   est servi étiqueté avant validation — sinon la mémoire reste vide.
2. **Un vocabulaire large remplit la file plus vite.** C'est le prix de la Q9 ; le compteur
   de refus et la validation en lot par source sont ce qui l'amortit.
3. **`AUTH_SECRET` partagé** : un sixième détenteur. Rotation coordonnée = six redéploiements
   le jour d'un incident. Documentée, jamais nulle.
4. **Le cookie dans l'iframe** ne concerne pas la phase 0 ; il se mesure le jour 1 de la
   phase 2, sur desktop et iPhone.
