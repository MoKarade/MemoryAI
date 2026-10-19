# ADR 0006 — Ce qui autorise un remplacement, et ce que devient l'ancien

- **Statut** : **ACCEPTÉ** — Marc a tranché les trois décisions du §5 le **18/09/2026**, en
  réponse à des questions posées après mesure. Il a suivi les trois recommandations.
- **Portée** : ce dépôt. Deux tables — `pieces` et `faits` — parce que c'est **le même
  principe vu deux fois**, et que deux règles séparées divergeraient (choix de Marc, §5.3).
- **Amont** : ADR 0001 (frontière, idempotence), ADR 0004 §6.2 (les papiers).
- **Aval** : le code part en **deux lots** — `[L39]` les pièces (il débloque l'import), puis
  `[L33d]` les faits (il réveille la règle de graphe `remplacement`).

---

## 1. Le défaut, mesuré

Trouvé par la revue de `[L38]`, vérifié dans le code le 18/09 :

- `empreintePiece(cle, sujet, fileId)` identifie **le document**, pas la lecture ;
- `lib/pieces/ecrire.ts` fait `dejaPresentes += 1; continue;` sur collision, **sans aucun
  `UPDATE`** — son en-tête le dit en toutes lettres : « une pièce déjà écrite est
  `dejaPresentes`, **jamais dupliquée ni réécrite** ».

**Conséquence** : les ~2 645 papiers venus de la migration de l'inventaire **ne peuvent pas
devenir « lus »**. DriveAI peut ouvrir le document, appeler un modèle, **payer l'appel** et
poster la pièce : même `sujet`, même `fileId` ⇒ même empreinte ⇒ ligne intacte, `extracteur`
toujours `moteur-inventaire-v1`. **L'argent part, rien ne change.**

⚠️ **L'idempotence n'est pas le défaut.** Refuser un double POST est juste, et cette règle a
été écrite pour ça. Ce qui manque est la distinction entre :

- « la même pièce **repostée** » — à refuser, et c'est le comportement actuel ;
- « la même pièce **enrichie par une vraie lecture** » — à accepter, et c'est ce qui n'existe
  pas.

### 1.1 L'enjeu n'est pas un compteur

La migration n'écrit que `type`, `emetteur`, `annee` et `domaine`, **devinés du nom de
fichier** — elle n'écrit **ni `resume` ni `recherche`** (vérifié : aucune occurrence dans
`lib/pieces/migrerInventaire.ts`).

Or `recherche` est la colonne que la recherche plein texte indexe, et le filtre est
`to_tsvector('french', coalesce(recherche, '')) @@ plainto_tsquery(…)`
(`lib/pieces/depotLecture.ts`). **Une colonne nulle ne matche rien.**

⚠⚠ **CE RAISONNEMENT ÉTAIT FAUX, ET C'EST LA MESURE DU LOT `[L39]` QUI L'A DIT.** La
migration n'ÉCRIT effectivement pas `recherche` — mais `validerPiece` la **DÉRIVE** du type,
de l'émetteur et de l'année (`texteRecherche`), et ces trois-là, elle les pose. Mesuré en
base (`tests/remplacerPiece.test.ts`) : une pièce d'inventaire porte bien
`recherche = "bail gestion exemple 2026"`, donc elle **est** trouvable.

La conclusion « 97 % de la mémoire n'est pas cherchable » est donc **retirée**. Le manque
réel est plus étroit et se dit autrement : ces papiers sont trouvables par leur **ÉTIQUETTE**
(un type et un émetteur devinés d'un nom de fichier), jamais par leur **CONTENU** — aucun
résumé, aucun champ, donc aucune réponse à « qu'est-ce que ce papier dit ? ». Cet ADR est ce
qui permet au contenu d'arriver.

⚠️ Et la leçon est celle du dépôt : **une ALARME se re-mesure autant qu'un DÉFAUT**. Le
défaut de ce §1 (l'écriture inerte) a été vérifié dans le code et il est exact ; son alarme
(« 97 % »), écrite par raisonnement sur ce que la migration ne pose pas, ne l'était pas. Un
raisonnement sur un champ ABSENT doit demander **qui d'autre le remplit** avant de conclure.

⚠️ L'en-tête de `depotLecture.ts` anticipait déjà cette classe, pour les pièces *chiffrées* :
« le dire plutôt que de laisser croire que la recherche couvre tout ». Le cas des pièces
*jamais lues* est le même trou vu d'un autre angle — à 97 % au lieu de quelques-unes.

### 1.2 Le même mécanisme manque aux faits

`faits.remplaceId` est **LU** (la règle de graphe `remplacement`, `lib/graphe.ts`) et **écrit
par personne** en production : seules des fixtures de test le posent. Cette règle de liaison
**ne peut donc pas tirer**, et ce depuis plusieurs lots.

Et côté pièces, `STATUTS_PIECE = ["active", "remplacee"]` et `pieces.remplaceId` existent au
schéma, **sans aucun producteur** non plus. Le mécanisme était entièrement prévu et jamais
branché — trois `champ-typé-sans-producteur` du même jour.

---

## 2. Ce qui autorise un remplacement

**Un seul sens est autorisé : un extracteur de MODÈLE remplace `moteur-inventaire-v1`, et rien
d'autre ne remplace jamais.**

En clair, pour une pièce :

| Existant | Entrant | Verdict |
|---|---|---|
| `moteur-inventaire-v1` | un extracteur de modèle | **remplacée** |
| `moteur-inventaire-v1` | `moteur-inventaire-v1` | `dejaPresentes` — rien à gagner |
| un extracteur de modèle | n'importe quoi | `dejaPresentes` — **jamais écrasée** |

⚠️ **Pourquoi la règle la plus étroite, et pas « la meilleure confiance gagne ».** La colonne
`confiance` existe, et s'en servir aurait permis de re-lire un document mal extrait. Mais un
modèle **s'auto-évalue** : il peut annoncer 0,9 sur une lecture pire que la précédente à 0,8 et
l'écraser. Une garantie qui repose sur l'honnêteté d'un modèle n'en est pas une.

⚠️ **Et pourquoi pas « la plus récente gagne ».** Une re-lecture ratée — document scanné de
travers, modèle qui répond mal — détruirait définitivement une bonne extraction, sans que rien
ne le signale. Un effacement silencieux est la pire des issues de ce dépôt.

**Conséquence assumée, et elle est dite plutôt que découverte** : corriger une lecture fausse
demandera un geste séparé. Cet ADR ne l'ouvre pas, et c'est délibéré — le besoin d'aujourd'hui
est de passer du nom de fichier au contenu, pas d'arbitrer entre deux lectures.

---

## 3. Ce que devient l'ancien

**Il est GARDÉ, marqué remplacé, et le neuf le désigne.**

- la pièce remplacée passe à `statut: "remplacee"` ;
- la pièce neuve porte `remplaceId = <id de l'ancienne>` ;
- rien n'est supprimé : on peut toujours voir ce que l'inventaire avait deviné du nom de
  fichier, et donc voir qu'une lecture a corrigé un type ou un émetteur.

C'est exactement ce qui a été décidé le matin même pour **corriger un fait** (`[L33b]`) :
l'ancien devient `perime`, jamais effacé, parce qu'il était vrai à sa date.

⚠️ **Pourquoi pas une mise à jour EN PLACE**, qui serait plus simple : on perdrait la trace de
ce que l'inventaire disait. Et `statut: "remplacee"` + `remplaceId` existent déjà au schéma
sans producteur — les brancher coûte moins que d'écrire un chemin nouveau.

⚠️ **Pourquoi pas une suppression logique** : `supprimeLe` veut dire « Marc a demandé d'oublier
ce papier ». L'employer ici confondrait deux décisions distinctes, et le statut affirmerait
quelque chose de faux.

### 3.1 La contrainte qui façonne l'implémentation

`pieces.empreinte` est `notNull` **et** sous `uniqueIndex("pieces_empreinte")`. Garder les deux
lignes est donc impossible tant que les deux portent la même empreinte : l'insertion de la
neuve violerait l'index.

**Décision** : au remplacement, l'ANCIENNE ligne **cède l'empreinte canonique** — la sienne est
réécrite sous une forme qui ne peut pas collisionner et qui dit ce qu'elle est
(`remplacee:<id de la ligne>`, unique par construction puisque `id` est la clé primaire).

⚠️ **Rien n'est perdu par cette réécriture.** L'empreinte est l'identité *pour l'idempotence* —
« cette pièce a-t-elle déjà été écrite ? » —, et une pièce remplacée n'est plus l'identité
vivante de son document. Le lien vers le document reste porté par ses exemplaires, et le lien
entre les deux lignes par `remplaceId`.

⚠️ **Et l'ordre des deux écritures compte** : l'ancienne cède son empreinte AVANT que la neuve
la prenne, sinon l'index refuse. Les deux écritures sont donc dans la MÊME transaction — un
échec entre les deux laisserait un document sans identité vivante, donc invisible à
l'idempotence : la prochaine passe en créerait une seconde copie.

---

## 4. Ce que cet ADR n'autorise pas

- **Pas de remplacement d'une vraie lecture par une autre** (§2). Re-lire un document déjà lu
  reste un `dejaPresentes`.
- **Pas de suppression.** Aucun chemin de cet ADR ne retire une ligne.
- **Pas d'élargissement du droit d'écriture.** Les mêmes jetons, les mêmes périmètres, le même
  contrat de validation (`validerPiece`) : ce qui change est ce qui arrive APRÈS la détection
  de collision, rien avant.
- **Pas de rétroaction sur les faits déjà migrés en papiers.** Le champ `origineFaitId` continue
  de dire d'où vient une pièce, et la réversibilité de la migration reste ce qu'elle était.

---

## 5. Les trois décisions de Marc — 18/09/2026

Posées après mesure, avec une recommandation chacune. **Il a suivi les trois.**

### 5.1 Qu'est-ce qui autorise un remplacement ?

> **« Seule une vraie lecture remplace un inventaire »** — l'option la plus étroite.

Écartées : « une confiance supérieure remplace » (un modèle s'auto-évalue) et « la plus récente
gagne » (une re-lecture ratée écraserait une bonne extraction en silence).

### 5.2 Que devient l'ancienne ligne ?

> **« Gardée, marquée remplacée »** — `statut: "remplacee"` + `remplaceId`.

Écartées : la mise à jour en place (perd la trace de l'inventaire) et la suppression logique
(confond « oublié par Marc » et « mieux lu »).

### 5.3 Portée : un seul ADR pour les pièces ET les faits ?

> **« Un seul ADR pour les deux »** — le principe est le même, deux règles divergeraient.

Le **code** reste en deux lots : `[L39]` les pièces d'abord, parce qu'il débloque l'import ;
`[L33d]` les faits ensuite, parce qu'il réveille la règle de graphe `remplacement`.

---

## 6. Ce que chaque « jamais » exige du code

Chaque interdit de cet ADR a sa ligne qui le re-vérifie au point d'écriture, et son test qui
tombe si on la retire. C'est la règle du §11 de `CLAUDE.md`, et elle s'applique ici mot pour
mot.

| Le « jamais » | Où il se tient | Ce qui tombe si on le retire |
|---|---|---|
| une vraie lecture n'est jamais écrasée | le verdict de remplacement, dans `ecrireLotPieces` | un test qui reposte une lecture sur une lecture et exige `dejaPresentes` |
| un inventaire ne remplace pas un inventaire | le même verdict | un test qui reposte la migration et exige zéro remplacement |
| rien n'est supprimé | aucun `delete` sur ce chemin | un test qui compte les lignes avant/après |
| l'ancienne est retrouvable | `remplaceId` sur la neuve | un test qui remonte de la neuve à l'ancienne |
| un enrichissement se DISTINGUE d'un ajout | `remplacees`, publié par `POST /api/pieces` | un test qui exige `remplacees: 1` là où `acceptees` vaut 1 dans les deux cas |
| un inventaire ne remplace pas une vraie LECTURE (sens inverse) | le même verdict | un test qui rejoue la migration APRÈS une lecture et exige que le résumé survive |
| l'ancienne cède l'empreinte canonique, dans cet ordre | `depot.remplacer`, en transaction | un test qui exige `remplacee:<id>` sur l'ancienne, et une 3ᵉ passe qui ne crée aucune copie |
| une pièce remplacée disparaît de ce que Marc VOIT | `vivante()` et `sortDeLaPiece` | un test qui cherche le papier et exige UNE réponse, pas deux |

⚠️ **Ce qui est prouvé et ce qui ne l'est pas.** Les six gardes de `tests/remplacerPiece.test.ts`
ont chacune été vue ROUGIR sur une perturbation qui la vise (les deux moitiés du verdict, le
statut, l'empreinte cédée, `remplaceId`, et l'état d'avant le lot). Ce qu'elles ne prouvent
**pas**, et il faut le dire plutôt que de le laisser croire : le ROLLBACK de la transaction.
Ce qui est mesuré est sa CONSÉQUENCE observable — un document garde exactement une identité
vivante, et une troisième passe ne crée aucune seconde copie.

⚠️ Et une garde qui manquerait à cette liste laisserait un interdit sans producteur — c'est
exactement le défaut que cet ADR corrige, recommis sur ses propres règles.
