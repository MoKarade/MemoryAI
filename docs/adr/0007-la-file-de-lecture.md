# ADR 0007 — La file de lecture : qui sait ce qui reste à lire

- **Statut** : **ACCEPTÉ** — 18/09/2026. L'ORDRE a été tranché par Marc le même jour, en QCM
  (« Par valeur d'émetteur d'abord », export Facebook « Les lire en DERNIER »). Le reste
  découle de sa demande du 18/09 : « je veux que ce soit lia qui lise tous mes fichiers ».
- **Portée** : ce dépôt (`[L35]`), et son consommateur dans DriveAI (`[L36]`).
- **Amont** : ADR 0001 (frontière d'écriture), ADR 0004 §6.2 (les papiers), **ADR 0006**
  (une vraie lecture remplace un inventaire — c'est ce qui rend cette file possible).

---

## 1. Le problème

DriveAI a les fichiers et un extracteur qui marche (`haiku-4.5-piece-v1`). Sa boucle de
rattrapage (`RattrapagePiece.gs`, C49-5) a lu 110 papiers — puis s'arrête **par conception** :
son idempotence est une liste de `fileId` dans une Script Property, plafonnée à 200 entrées
contre les ~9 Ko, et l'étape **refuse** une tranche plus grande plutôt que de le découvrir en
production. Son propre en-tête le dit : « la tranche suivante demandera un autre mécanisme
d'idempotence ».

Il reste **~2 645 papiers** à lire. Ce qui manque n'est ni un extracteur ni un budget : c'est
**quelqu'un qui sache ce qui est déjà fait**, à une échelle qu'une Script Property ne tient pas.

## 2. Décision : l'idempotence vit dans la Mémoire

**La Mémoire sait déjà ce qui est lu** : depuis l'ADR 0006, une vraie lecture REMPLACE la pièce
d'inventaire. La file est donc une simple requête — *les pièces actives dont l'extracteur est
encore `moteur-inventaire-v1`* — et **un papier lu en sort tout seul**, sans que personne ne
le marque.

Conséquences, et elles sont le but :

- perdre un curseur, relancer une passe, changer de machine ou de voie : **rien ne peut faire
  relire un document** ;
- aucun plafond de taille : la file est une requête sur une table indexée, pas une liste ;
- l'état de l'import se lit à UN endroit (l'onglet Dépenses), pas dans deux dépôts.

## 3. Le seul état neuf : les lectures TENTÉES

Un document qui **ne donne rien** — photo sans texte, fichier disparu, extraction vide, pièce
refusée — ne remplace rien. Sans marque, il resterait **en tête de file pour toujours**, et la
boucle paierait son OCR (parfois son appel de modèle) à chaque passe sans jamais avancer.
DriveAI a déjà nommé cette panne : « la marque se pose sur toute issue DÉFINITIVE ».

D'où une table, `lectures_tentees(file_id, extracteur, motif, tente_le)` :

- **l'extracteur est dans la clé primaire**. Un verdict dit « CE lecteur n'en a rien tiré »,
  jamais « ce papier est illisible ». Un extracteur neuf ré-ouvre tout, sans rien effacer —
  le patron « le tag est DANS la valeur » de DriveAI ;
- **les motifs sont une liste FERMÉE d'issues propres au DOCUMENT**. Une panne de canal
  (jeton refusé, réseau, frein budget) **n'est pas un verdict** et la route la refuse : la
  noter sortirait de la file des papiers parfaitement lisibles, en silence. La question qui
  tranche est celle de DriveAI : « si cette cause est vraie, combien de documents échouent ? »
  Un seul ⇒ verdict ; tous ⇒ panne ;
- **`sans-effet` est un coupe-circuit sur la DÉPENSE, pas un jugement sur le papier** : le
  document a été lu, la pièce envoyée, et la Mémoire n'a rien changé (déjà présente, ou
  oubliée par Marc). Sans lui, ce papier reviendrait en tête de file et coûterait un OCR
  ET un appel de modèle à chaque passe — l'écriture inerte de l'ADR 0006, recommise par la
  file elle-même ;
- **un verdict sur un fichier que l'inventaire ne connaît pas n'écrit rien**, et il est
  compté (`inconnus`) — la table ne doit pas pouvoir se remplir de lignes sans objet ;
- rien ici n'est un contenu : un `fileId` opaque, un motif, une date.

⚠️ **Ce que ça change à l'écran, et c'est dit plutôt que découvert** : un papier essayé sans
résultat reste un « restant » — personne ne l'a lu. La jauge de l'onglet Dépenses ne montera
donc pas jusqu'à 100 %, et la page dit combien, et pourquoi, plutôt que de s'arrêter à 97 %
sans explication.

## 4. L'ordre — tranché par Marc

1. les émetteurs **nommés**, dans l'ordre de la variable `MEMORYAI_EMETTEURS_PRIORITAIRES`
   (noms séparés par `|`). Depuis le 15/10/2026 la liste n'est plus dans le dépôt : elle dit
   avec qui Marc a affaire (donnée personnelle). Variable absente : seul « Revenu Québec »
   passe devant, et rien n'est écarté ;
2. tout le reste (dont les papiers sans émetteur) ;
3. **l'export Facebook en DERNIER** — « Fichier HTML », « Fichier de configuration » : c'est
   l'échafaudage d'un dump, pas sa vie. Les quatre graphies sont celles **mesurées** dans son
   corpus (`lib/pieces/familles.ts`).

À rang égal : le plus **récent** d'abord, puis l'`id` — un ordre TOTAL, sans quoi deux passes
pourraient se voir servir deux tranches qui se chevauchent.

⚠️ **L'ordre se calcule sur des clés KEYÉES** (`cleFacette`), donc **sans rien déchiffrer**.
La limite connue : une graphie différente (« Caisse Aurore ») tombe au milieu de la file.
Elle est lue quand même ; un regroupement flou ferait passer n'importe quoi devant. Même
arbitrage que `familles.ts`.

## 5. Ce qui sort, et à qui

`GET /api/pieces/file` rend des **`fileId`** et un compte (`restants`). **Aucun type, aucun
émetteur, aucun résumé.** Ces identifiants retournent à l'app qui les a elle-même fournis à
l'inventaire : aucune information neuve ne quitte la Mémoire.

Le jeton est celui d'un **écrivain** (`role: "ecriture"`), re-vérifié à l'entrée des deux
verbes : servir la file à un jeton de lecture lui ferait payer OCR et appels de modèle pour
des pièces que `POST /api/pieces` refuserait ensuite.

**Le gel de Marc (`MEMORYAI_GEL=1`) arrête la lecture** : la route rend 503 avant de lire le
jeton, et DriveAI traite ce 503 comme ses autres pannes de canal (suspension, puis re-sonde).

### 5.1 Le contrat IMPLICITE entre la file et l'écriture — trouvé par la revue, 18/09

La file sert le `fileId` de l'exemplaire **principal** d'une pièce d'inventaire. Le
remplacement (ADR 0006), lui, se décide sur `empreintePiece(cle, sujet, fileId principal)` de
la pièce **entrante**. Les deux ne coïncident que si le lecteur renvoie **le même sujet** et
**le fichier servi en PREMIER exemplaire**.

Sinon : la pièce est acceptée comme une pièce **neuve** (`acceptees: 1`), l'inventaire reste
actif, aucun verdict n'est posé — et le papier revient en tête de file pour toujours, en
repayant son OCR et son appel de modèle à chaque passe. Tout a l'air d'avoir marché.

**Décision** : le consommateur juge sur **`remplacees`**, jamais sur `acceptees`. La file ne
sert QUE des papiers d'inventaire, donc toute lecture réussie DOIT en remplacer un ; un « ok »
sans remplacement se note `sans-effet`. C'est ce que fait `LectureFile.gs` (DriveAI), et un
test le prouve par perturbation. Aujourd'hui `pieceMemoire_` envoie toujours `sujet: "marc"`
et un seul exemplaire — le cas ne se produit donc pas ; la garde existe pour le jour où un
second exemplaire ou un second lecteur arrivera.

## 6. Ce que cet ADR ne tranche PAS

**La VOIE d'exécution côté DriveAI** — le tick Apps Script (frontière étroite : seuls les
champs sortent du compte Google) ou le runner de l'ADR-0061 Q1 (le texte OCR sort). La file
sert les deux à l'identique : elle ne sait pas qui la consomme. Ce choix appartient à l'ADR
-0061 de DriveAI et à Marc.

## 7. Ce que chaque « jamais » exige du code

| Le « jamais » | Où il se tient | Ce qui tombe si on le retire |
|---|---|---|
| un papier lu n'est jamais resservi | le critère `extracteur = migration` + `statut = active` | le test qui lit un papier et exige qu'il quitte la file |
| un papier sans résultat ne bloque jamais la file | `NOT EXISTS lectures_tentees` | le test qui pose un verdict et exige le papier suivant |
| un verdict ne condamne jamais un papier pour un AUTRE lecteur | l'extracteur dans la clé | le test qui redemande la file sous un lecteur neuf |
| une panne de canal n'est jamais un verdict | la liste fermée `MOTIFS_VERDICT` | le test qui soumet `jeton-refuse`, `reseau`, `frein-budget`… |
| Facebook ne passe jamais devant | le rang `n + 1` | le test où Facebook est le plus RÉCENT et sort quand même dernier |
| la file n'est jamais servie à un lecteur | le 403 `ecriture_requise` | le test de route, sur les deux verbes |
| la migration n'est jamais un lecteur | `extracteurValide` | le test pur + le 400 de la route |

Dix perturbations ont été jouées sur ces gardes, une par garde : dix rouges, contrôle vert.
