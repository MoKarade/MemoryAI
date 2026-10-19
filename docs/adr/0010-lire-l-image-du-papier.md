# ADR 0010 — Lire l'IMAGE du papier, et tout ce qu'elle porte

- **Statut** : **ACCEPTÉ** — Marc, 24/09/2026 : « Vision Sonnet partout », « Tout relire »,
  « 100 $ au total », puis « OK lance L1 ».
- **Portée** : ce dépôt — la lignée des extracteurs (`lib/pieces/lignee.ts`) et deux bornes du
  contrat `POST /api/pieces` (`lib/pieces/validerPiece.ts`). Rien d'autre ne bouge ici.
- **Jumeau** : l'ADR-0063 de DriveAI, qui décide ce qui SORT de son compte (le fichier lui-même,
  plus seulement son OCR). Les deux se livrent ensemble : un nom ajouté ici sans l'autre côté
  ne lit rien, et l'inverse fait ranger chaque lecture payée en « déjà présente ».
- **Amont** : ADR 0004 (tout entre), ADR 0008 (une lecture plus récente de la lignée remplace).

---

## 1. Ce qui l'a déclenché

Marc, 24/09 : « si je demande mon numéro de passeport je veux le voir […] il m'a demandé
l'échéance de mon passeport, ça il devrait l'avoir lu […] il ne récupère pas assez d'info par
document. Littéralement TOUT est à récupérer, même une analyse de ma tête sur mon passeport ».

Mesuré le même jour, deux causes, et aucune n'est dans ce dépôt :

1. **La lecture passait par l'OCR.** Un passeport photographié rendait des fragments (« HARD
   FLEX T 014 ») et le modèle, honnêtement, répondait « illisible ». Le document était lisible ;
   c'est sa transcription qui ne l'était pas. Même chose pour les PDF chiffrés, les TIFF, les
   PNG à palette (C49-28 de DriveAI).
2. **Le prompt demandait un résumé et quatre familles**, avec 40 champs libres et 600
   caractères de résumé. Un relevé bancaire de trois pages y perd la moitié de ses lignes.

## 2. La décision

1. **Rang 3 de la lignée : `sonnet-5-vision-piece-v3`.** Le modèle reçoit le fichier (PDF en
   bloc `document`, image en bloc `image`) et un prompt qui demande TOUT. En queue de lignée,
   donc il remplace v1 et v2 ; l'ancienne lecture est GARDÉE, comme l'ADR 0008 l'exige.
2. **Deux bornes relevées, aucune retirée** : résumé 600 → **1 500** caractères, champs libres
   40 → **80**. La décision n° 9 de l'ADR 0004 tient — une pièce n'est pas le texte intégral —
   et un test garde un PLAFOND (≤ 2 000, ≤ 100) plutôt qu'une valeur, pour qu'un réglage futur
   ne la dissolve pas en silence.
3. **L'apparence de Marc** (« une analyse de ma tête ») arrive comme un champ libre ordinaire,
   au niveau du papier qui la porte — donc N3 pour un passeport. Rien de neuf ne sort : c'est
   une valeur de plus sous les mêmes verrous (ADR 0007). DriveAI ne la garde que si le
   titulaire lu est Marc lui-même ; celle d'un proche ne part pas.

## 3. Ce que ça ne change pas

- Aucune table, aucune colonne, aucune migration.
- Le niveau reste dérivé par le code ; un papier d'identité reste N3, chiffré, hors de la
  recherche plein texte.
- La lignée reste FERMÉE : un producteur qui s'étiquetterait « v4 » sans ce fichier ne remplace
  rien.

## 4. Coût, dit une fois

Sonnet 5 : 2 $ / 10 $ par million de jetons, et son tokenizer compte ~30 % de plus qu'avant. Une
page d'image coûte de l'ordre de 1 500 à 3 000 jetons d'entrée. Estimation avant mesure :
**3 à 5 ¢ par papier** — donc 100 $ couvrent ~2 000 à 3 000 papiers sur ~4 300, et l'ordre de
lecture (04 → 01 → 02 → 05 → 03 → 08 → 07 → 09) décide lesquels passent en premier. Cette
estimation est remplacée par la mesure de l'audit sur 20 papiers (DriveAI, onglet
`AuditVision`) **avant** toute campagne.
