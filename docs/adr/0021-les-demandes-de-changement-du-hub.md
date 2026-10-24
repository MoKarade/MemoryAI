# ADR 0021 — Les demandes « Que peut-on changer ici ? » du hub sont gardées dans MemoryAI

- **Statut** : **proposé** (24/10/2026, fil MemoryAI). Il applique la décision du fil Assistant du
  24/10/2026 (Hubperso#450) et la règle de Marc du 23/10 : ce que Marc demande à l'assistant est
  gardé. Tâche : MemoryAI#169. Le code attend l'OK de Marc (protocole, `docs/claude/11-protocole.md`).
- **Amont** : ADR 0001 (frontière, oublis), 0016 (LIA répond au hub), 0017 (LIA vit dans MemoryAI).

## Contexte

Dans le hub, le menu « Que peut-on changer ici ? » pose une question à LIA sur un élément de la
page, mais la demande de Marc n'est gardée nulle part : il ne peut pas retrouver ce qu'il a voulu
changer. Le hub n'a pas de mémoire de LIA, MemoryAI en a une. Le danger est connu : le texte d'une
page est écrit par une app, et une app peut porter une fausse consigne. Une demande ne doit donc
jamais transporter du texte de page.

## Décision

1. **Une table `demandes`, pas la table `faits`**. Une demande n'est pas un fait sur Marc : elle n'a
   ni source à fiabiliser, ni validation à attendre, et elle ne doit jamais être servie comme sûre à
   un modèle. La ranger avec les faits l'exposerait à la pile vrai/faux et à la recherche.
2. **Un contenu borné, sans texte libre** : `type` dans un enum (`changer` seul pour l'instant),
   `app` dans la liste des apps du parc, `genre` dans un enum court (tuile, bouton, page, graphique,
   texte, autre), `nom` limité à 80 caractères sans `<` ni retour à la ligne, `demandeLe`. Tout autre
   champ est refusé (422), jamais retiré en silence.
3. **Le `nom` est une DONNÉE** : il est chiffré au niveau 1 et ne sort que comme valeur d'un champ JSON
   (jamais dans un prompt dans ce lot). Aucune route ni aucun outil ne l'interprète, donc il ne peut
   jamais devenir une action. S'il entre un jour dans un prompt, il y passera balisé, comme
   `baliserVoix` ou `baliserProfil`.
4. **La porte** : `POST` et `GET /api/demandes`, `x-hub-token` en temps constant, côté serveur du
   hub seulement, comme `/api/etat-lia`. Le hub dit `x-lia-proprietaire: 1` après avoir vérifié la
   session ; un invité ne dépose rien. Codes : 503 sans `HUB_TOKEN`, 401 jeton faux, 403 propriétaire
   non dit, 503 gelée (lecture ET écriture), toujours `no-store`, aucun refus en cache.
5. **Idempotent et oubliable** : une empreinte keyée `(type, app, genre, nom, jour)` est unique ;
   la même demande le même jour n'en crée pas une deuxième. `oublis` est consulté avant toute
   insertion ; oublier une demande pose son empreinte, et elle ne revient pas.
6. **La liste** : `GET` rend les 100 plus récentes, champs du schéma seulement, du plus récent au
   plus ancien. Le hub l'affiche ; MemoryAI ne l'envoie à aucun modèle dans ce lot.

## Le contrat, tel que codé (24/10/2026, PR de la tâche MemoryAI#169, en brouillon)

- `POST` : corps JSON strict de 2 Ko au plus (au-delà 413, illisible 400). `nom` rogné puis 1 à 80
  caractères, sans `<`, `>` ni caractère de contrôle. `demandeLe` en ISO 8601 AVEC fuseau, posé par
  le hub ; plus de 5 minutes dans le futur, refusé. Champ inconnu ou invalide : 422
  `{ error: "champs_invalides", champs: [...] }`, les chemins des champs, jamais leur valeur.
- Réponses : 201 `{ id, demandeLe, nouvelle: true }` ; 200 `{ id, demandeLe, nouvelle: false }` pour
  la même demande le même jour de Québec ; 410 `{ error: "oubliee" }` si son empreinte est dans
  `oublis`, rien n'est écrit.
- `GET` : 200 `{ demandes: [{ id, type, app, genre, nom, demandeLe }] }`, `nom` déchiffré.
- Code : `lib/demandes.ts` (pur et I/O séparés), `app/api/demandes/route.ts`, migration
  `drizzle/0027_demandes.sql`. Preuve : `tests/demandes.test.ts` (PGlite, données fictives).

## Ce qui reste ouvert

- [À vérifier] la liste exacte des `genre` avec le fil Refonte Hubperso (Hubperso#359 décrit
  l'élément visé).
- L'écran de la liste et l'oubli d'une demande depuis le hub : côté Hubperso#450.
