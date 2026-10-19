# ADR 0015 — Le jeton dit QUI écrit : papiers réservés, lignée et quarantaine par app, refus uniforme (INC-31)

- **Statut** : **ACCEPTÉ (Marc, 30/09/2026, 15:07)** — approuvé sans correction par pole-securite le même jour (protocole `docs/claude/11-protocole.md`).
- **Déclencheur** : INC-31, trouvé le 30/09/2026 par le lot 2 de sécurité (cloisonnement croisé). Preuve :
  `tests/cloisonnementTrous.test.ts` (commit `985d4f4`), cinq cas en `it.fails`.
- **Portée** : ce dépôt. Routes `POST /api/pieces`, `GET|POST /api/pieces/file`, `POST /api/faits`,
  `POST /api/conversations`, `POST /api/avancement` ; `lib/jetons.ts`, `lib/pieces/lignee.ts`,
  `lib/pieces/ecrire.ts`, `lib/ecrireFaits.ts`, `lib/vocabulaire/quarantaine.ts`.
- **Amont** : ADR 0001 §3 (« un jeton = une app = un rôle = un périmètre »), qu'il fait enfin
  respecter ; ADR 0004 §2.3 (quarantaine) et ADR 0008 (lignée), qu'il **AMENDE** sur un seul point :
  d'où vient l'identité de l'écrivain.

---

## 1. Ce qui a été trouvé

L'ADR 0001 pose que l'app se déduit du **jeton**, jamais de la requête. `identifierEcrivain` le
fait bien. Mais trois décisions en aval lisent encore une identité **déclarée dans le corps** :

1. **Les papiers ne sont liés à aucune app** (gravité élevée). N'importe quel jeton d'écriture
   écrit dans `POST /api/pieces` et lit la file `/api/pieces/file`. La lignée (ADR 0008) compare
   le nom d'`extracteur` écrit dans le corps. Une autre app qui se déclare
   `sonnet-5-vision-piece-v3` **remplace** donc un papier lu par DriveAI, et peut sortir des
   documents de sa file. Prouvé : `remplacees = 1`.
2. **La quarantaine compte des noms, pas des écrivains** (gravité moyenne). « Trois extracteurs
   distincts » font sortir un prédicat inconnu. Un seul jeton qui déclare trois noms fait donc
   servir ce prédicat aux modèles sans que Marc l'ait vu. C'est plus fort que le risque 4 de
   l'ADR 0004 : ici, un seul écrivain suffit.
3. **Un refus en dit trop** (gravité faible). Un jeton valide hors de son rôle ou de son app
   reçoit 403 (ou 503) là où un jeton inconnu reçoit 401. `/api/conversations` renvoie même le
   nom de l'app. Seul un détenteur de jeton en tire quelque chose, mais la promesse « aucune
   énumération » ne tient pas.

## 2. La décision

### 2.1 Les papiers et la file sont réservés à une liste fermée d'apps
`APPS_PIECES = { driveai }`, écrite dans le code, sur le modèle de `APPS_AUTORISEES` de
`/api/conversations` (`{ claudecode }`). Un jeton d'écriture d'une autre app reçoit le refus
uniforme (§2.3) sur `POST /api/pieces` et sur `/api/pieces/file`, **avant** toute lecture du corps
ou de la base. L'écrivain interne `migration-inventaire` (en processus, sans jeton) n'est pas
concerné : il n'a aucune route.
Ajouter une app à cette liste est une décision de frontière : un ADR et l'OK de Marc.

**La restriction couvre la LECTURE autant que l'écriture** (demande de pole-securite, 30/09). Un
jeton qui n'est pas celui d'une app de `APPS_PIECES` ne peut ni écrire, ni remplacer, ni **lire**
la file des papiers. Chaque méthode est couverte : `POST /api/pieces`, `GET /api/pieces/file` (qui
rend des `fileId`) et `POST /api/pieces/file` (verdicts). Toutes rendent le refus uniforme du §2.3.
Un test d'acceptation par méthode le prouve (§2.4).

### 2.2 Lignée et quarantaine : l'identité vient de l'APP DU JETON
- **Papiers.** Chaque papier garde l'app qui l'a écrit (`pieces.ecrivain_app`, nouvelle colonne).
  La lignée devient **par app** : `LIGNEE_EXTRACTEURS = { driveai: [...] }`. Un nom d'extracteur
  n'a de rang que dans la lignée de l'app que le jeton prouve. `peutRemplacer` n'autorise plus que :
  - (ADR 0006 §2) un papier écrit par `migration-inventaire` est remplacé par une app de `APPS_PIECES` ;
  - (ADR 0008) un papier est remplacé par la **même** app, avec un rang strictement supérieur dans
    **sa** lignée.
  Tout le reste est `dejaPresentes`, comme aujourd'hui.
- **Quarantaine.** Le compte « trois sources indépendantes » porte sur des `appId` distincts
  (ceux d'`Ecrivain`), jamais sur des noms d'extracteur. `marc` et `chat` sont Marc : ils comptent
  pour **une** source. Le seuil reste 3 (`SEUIL_SOURCES_INDEPENDANTES`). Conséquence assumée :
  avec les écrivains d'aujourd'hui, la sortie par le nombre devient rare, et la sortie par le clic
  de Marc (`/a-valider`) devient la voie normale. C'est le côté sûr.

### 2.3 Refus uniforme
Une seule fonction, `refusJeton()` dans `lib/jetons.ts`, rend **toujours**
`401 { "error": "non_autorise" }`, avec `Cache-Control: no-store` et sans message ni nom d'app.
Elle couvre :
- un jeton absent, mal formé, faux ou trop court ;
- un jeton valide de rôle `lecture` sur une route d'écriture ;
- un jeton valide d'une app hors liste (`APPS_PIECES`, `APPS_AUTORISEES`) ;
- une app dont Marc a retiré l'écriture (`perimetres.role = lecture`).

**L'ordre est la garde** : gel, puis identité, rôle et liste d'apps, puis clé et base (503), puis
corps. Un jeton hors rôle ou hors app ne voit donc jamais un 503. La règle « une panne n'est
jamais un refus » reste vraie, mais seulement pour un écrivain légitime. Seul le retrait par Marc
exige la base : une app retirée peut encore voir un 503 si la base est en panne. C'est accepté,
elle est connue de Marc.
`GET /api/etat` (des nombres seulement) reste ouvert à tout jeton connu. **Tranché par pole-securite le 30/09 : il reste ouvert.**
Ce qu'il rend est un agrégat global, jamais découpé par app, qu'elle appelle ou qu'elle écrive. La frontière est garantie par `composerEtatPublic` (des agrégats seulement) et testée par `tests/routeEtat.test.ts` (l. 155-160) : chaque valeur est typée nombre, et un motif interdit refuse les noms et les fichiers.

### 2.4 Chaque « jamais » a sa ligne de code et son test
| Garde | Ligne qui la re-vérifie | Test qui tombe si on la retire |
|---|---|---|
| papier hors `APPS_PIECES` | route `pieces` et `pieces/file`, puis `ecrireLotPieces` | TROU 1 (devient `it`) ; plus un cas par méthode (`POST /api/pieces`, `GET` et `POST /api/pieces/file`) : jeton d'écriture CarAI ⇒ même `401` qu'un jeton inconnu, et rien de lu ni d'écrit |
| remplacement d'une autre app | `peutRemplacer(existant.app, …)` | TROU 1 ; nouveau cas « même rang, autre app » |
| quarantaine par app | `proposerPredicat(predicat, ecrivain.appId)` | TROU 2 (devient `it`) |
| refus uniforme | `refusJeton()` sur les 5 routes | TROU 3, trois cas (deviennent `it`), plus un cas `avancement` |

**Tests d'acceptation** : les cinq `it.fails` de `985d4f4` passent en `it` et en vert, puis vont dans
`tests/cloisonnementCroise.test.ts`. Tests existants à modifier dans la même PR (ils attendent
aujourd'hui les codes distincts) : `perimetres`, `ecrirePieces`, `routeFileDeLecture`,
`cloisonnementCroise` (le cas `source_non_autorisee`).

## 3. Données existantes (migration additive et idempotente)
- `pieces.ecrivain_app` : colonne ajoutée et remplie une fois. `extracteur = EXTRACTEUR_MIGRATION`
  ⇒ `migration-inventaire`, sinon ⇒ `driveai`. **[À vérifier par Marc sur `/apps`]** : DriveAI doit
  être la seule app à détenir un jeton d'écriture. Si une autre en a un, on s'arrête avant de remplir.
- `predicats_proposes` : nouvelle colonne `apps` (JSON). Les listes de noms existantes ne peuvent
  pas être reliées à une app. Les prédicats déjà sortis « par sources » gardent leur statut, et
  leur liste est montrée à Marc sur `/a-valider` pour qu'il la confirme. Aucun retour automatique
  en quarantaine.
- Aucune colonne supprimée, aucune valeur réécrite.

## 4. Ce qui change pour DriveAI
- **Rien à configurer** : son jeton (`DriveAI_MEMORYAI_TOKEN` dans les propriétés d'Apps Script)
  correspond déjà à `MEMORYAI_TOKEN_DRIVEAI_ECRITURE`, et DriveAI est dans `APPS_PIECES`.
- Les noms d'extracteur qu'il envoie ne changent pas. Sa lignée garde le même ordre.
- Seul changement visible : si Marc retire l'écriture à DriveAI, `Memoire.gs` (l. 436 et 1018)
  recevra 401 au lieu de 403. Sa santé affichera « jeton-refuse » au lieu de « perimetre-retire ».
  Les deux arrêtent l'envoi. Une ligne de doc côté DriveAI, sans code obligatoire.

## 5. Retour arrière
- Code : revenir à la PR précédente (retour arrière Vercel vers le déploiement d'avant). Les deux
  colonnes ajoutées restent, inutilisées, sans effet.
- Si DriveAI est bloqué par erreur (401 inattendu) : retour arrière immédiat, puis recherche. DriveAI
  rejoue ses lots, rien n'est perdu (écritures idempotentes).
- Les prédicats sortis de quarantaine sous la nouvelle règle restent acceptés après un retour
  arrière. Marc peut les refuser d'un clic.

## 6. Ce que cet ADR n'autorise toujours pas
- Aucune app ne choisit son identité : ni `appId`, ni rôle, ni rang de lignée ne se lisent dans une requête.
- Aucun nouveau jeton, aucune nouvelle route. La rotation des jetons (lot 4) est un autre sujet.
