# ADR 0003 — Un fait MÉCANIQUE ne passe pas par l'œil de Marc

- **Statut** : **accepté** (Marc, 16/09/2026, par choix explicite : « Non, auto-validés »).
- **Portée** : ce dépôt. Rien n'est demandé aux autres — DriveAI pousse déjà ce qu'il faut.
- **Amont** : ADR 0001, dont le §5.1 pose « le statut est `propose` » sans exception, et dont
  le §9.1 annonçait le risque que cet ADR solde : « la file à valider est le vrai risque du
  projet ». Cet ADR **amende ce point-là, et rien d'autre**.

## 1. Le problème, mesuré

Le canal DriveAI → MemoryAI a été réparé le 16/09 (trois causes empilées, voir le HANDOVER de
DriveAI). Première passe réelle : **2 348 faits acceptés**, `aValider: 2 725`. L'inventaire
complet vaut **~19 900 documents**, donc autant de faits à venir.

Marc, le même jour : « je veux pas valider chaque fait a la main, je veux que l'IA lise tout
et ensuite me pose des questions précises et simple a repondre, si besoin ».

Une file de 19 900 lignes ne se valide pas à la main, et elle ne se traite pas non plus par
des questions : il n'y a **aucune question utile à poser** sur « le document `1AbC…` existe et
se trouve là ». Le relire une par une ne ferait qu'ensevelir les faits qu'un modèle a
DÉDUITS — les seuls qui méritent son œil, et les seuls sur lesquels une question a un sens.

C'est exactement le mode de panne que DriveAI a payé et que l'ADR 0001 §9.1 avait nommé : un
garde « dans le doute, en revue » qui, appliqué à tout, neutralise l'automatisation qu'il
protégeait. Ici la version du piège est une mémoire pleine que personne ne valide jamais.

## 2. La décision

Un fait est **MÉCANIQUE** — donc `statut: "valide"` dès l'écriture — quand son couple
(extracteur, prédicat) figure dans `COUPLES_MECANIQUES` (`lib/autoValidation.ts`). Un seul
couple aujourd'hui : `moteur-inventaire-v1` × `document.existe`.

Tout le reste garde le défaut `propose` de l'ADR 0001.

**La règle porte sur la PROVENANCE, jamais sur le contenu.** Un fait mécanique n'a pas été
jugé « sûr » : il n'a **jamais vu de modèle**. L'écrivain est identifié par son jeton, le
prédicat est fermé par le vocabulaire, la valeur est un `fileId` que l'Index de DriveAI porte
déjà. Il n'y a rien à relire, parce qu'il n'y a rien qui ait pu être inventé.

### Ce qui ne bouge pas

- **Le NIVEAU reste dérivé par le code** (`niveau = MAX(code, LLM)`) : auto-valider ne rend
  rien plus accessible. Les 84 faits N3 de l'inventaire restent N3, donc hors de tout
  périmètre d'app, exactement comme avant.
- **Un CANARI ne s'auto-valide JAMAIS**, quelle que soit sa provenance. C'est le premier
  test du prédicat, avant même le couple.
- **`oublis` d'abord**, comme sur tous les chemins : un fait oublié ne revient pas.
- Un fait que Marc a **REJETÉ** ne se fait pas re-valider dans son dos (le rattrapage ne
  touche que `statut = 'propose'`).

### Ce que `valide_le` veut dire, maintenant que ça compte

`valide_le` = **quand ce fait est devenu valide**, pas « quand Marc l'a touché ». Le flux le
pose pour un fait mécanique ; `depotAdmin` le posait déjà quand Marc valide.

Sans ça, 19 900 faits `valide` à `valide_le NULL` auraient fait retomber le `dataAsOf` du hub
à `null` — `ORDER BY valide_le DESC` met les NULL en PREMIER sous Postgres. La carte du hub
aurait cessé d'afficher une fraîcheur le jour où la mémoire s'est mise à se remplir. Ce qui
distingue encore « validé par Marc » de « mécanique » n'est pas cette colonne mais la
PROVENANCE, et `estMecanique` sait la relire.

## 3. Le rattrapage, livré dans le même lot

Les 2 725 faits déjà en base sont rattrapés par `drizzle/0007_auto_validation_mecanique.sql`.
Le flux ne regarde jamais en arrière : sans cette migration, le stock d'avant resterait
`propose` pour toujours et la file ne descendrait jamais — le défaut exact que DriveAI a payé
trois fois (`ville`, `adresse`, puis les quatre listes de colonnes).

Le rattrapage est une **seconde écriture de la même règle**, en SQL. C'est ce qui pouvait mal
tourner, et ce qui le tient : `tests/autoValidation.test.ts` dérive la liste des couples du
CODE et exige que chacun soit couvert par une migration de `drizzle/`. Un couple ajouté plus
tard reçoit donc sa **propre** migration — on ne réécrit jamais un fichier déjà appliqué, son
empreinte le ferait rejouer.

## 4. Ce qui reste ouvert, et qui n'est PAS livré ici

La demande de Marc a deux moitiés. Celle-ci en règle une : la file ne garde plus que ce qu'un
modèle a déduit. **L'autre — « que l'IA lise tout et me pose des questions précises » — reste
entière** : le producteur de questions (`/questions` existe depuis le lot 7, plafonné à cinq
questions ouvertes) n'est pas branché sur les faits `propose` restants. C'est le lot suivant,
et il n'est pas décidé ici.

## 5. Risques

1. **Un couple ajouté à la légère ouvre une vanne.** La liste est FERMÉE, en code, et chaque
   ajout exige une migration et une relecture de cet ADR. Ce n'est pas un réglage.
2. **Un extracteur compromis écrirait du `valide` sans repasser devant personne.** C'est déjà
   vrai du `niveau` et de la `fiabilite_source`, qui sont dérivés du jeton : la frontière
   reste le jeton, et il est par app et par rôle. Ce que ça change vraiment, c'est qu'un abus
   ne serait plus visible dans la file — donc il se surveille par le compteur de faits par
   prédicat (`/moi`), pas par la file.
3. **`aValider` va chuter d'un coup.** C'est l'effet voulu, pas une perte : rien n'est
   supprimé, et « oublier » reste possible sur un fait valide comme sur un fait proposé.
