# ADR 0008 — Relire un papier déjà lu, sans rouvrir la porte que l'ADR 0006 a fermée

- **Statut** : **ACCEPTÉ** — demande explicite de Marc le **21/09/2026** (« fais A »), après
  le diagnostic du passeport.
- **Portée** : ce dépôt, table `pieces`. Les faits ne sont pas touchés.
- **Amont** : ADR 0006 §2, qu'il **AMENDE** — c'est le seul point de cette décision qui bouge.
- **Aval** : `lib/pieces/ecrire.ts`, et un tag à bumper des deux côtés quand on veut relire.

---

## 1. Ce qui a déclenché l'amendement

Le 21/09, la lecture de niveau 3 a été ouverte (ADR 0007) et Marc a pu enfin voir le contenu
de ses papiers d'identité. Un de ces papiers était **fabriqué** : résumé dans une autre langue
que celle du document, numéros tirés d'inscriptions de fabricant, aucune date de naissance.

Mesuré le jour même, en lisant l'OCR source : la photo ne porte que des fragments sans
rapport avec un papier d'identité. Le modèle n'avait **aucune façon de dire non**,
alors il a rendu la réponse la plus serviable — un passeport plausible. La cause est traitée
côté DriveAI (C49-7 : le champ `lisible`, et un refus qui ne s'écrit pas).

**Mais ce correctif ne vaut que pour les papiers à venir.** L'ADR 0006 §2 interdit qu'une
vraie lecture en remplace une autre, donc les papiers déjà lus gardent à vie l'extraction
produite par la version du prompt en vigueur ce jour-là — sans la consigne « date de
naissance » (20/09), sans la porte « illisible » (21/09), et sans celles qui viendront.

C'est une dette qui grandit à chaque amélioration du prompt, et que rien ne rattrape.

---

## 2. Ce que l'ADR 0006 avait examiné, et ce qu'il n'avait pas examiné

Son §2 a opposé deux critères, et il a eu raison de refuser les deux :

- **« la meilleure confiance gagne »** — un modèle s'AUTO-évalue : il peut annoncer 0,9 sur
  une lecture pire qu'une précédente à 0,8. Une garantie qui repose sur l'honnêteté d'un
  modèle n'en est pas une.
- **« la plus récente gagne »** — une re-lecture ratée détruirait une bonne extraction sans
  que rien ne le signale.

Les deux critères répondent à des questions que la machine ne sait pas trancher : *qui est le
meilleur ?* et *qui est le dernier ?*. Il en reste une troisième, que l'ADR 0006 n'a pas
posée : **qui l'a DEMANDÉ ?**

---

## 3. La décision

**Un extracteur remplace un autre quand, et seulement quand, MemoryAI le déclare
STRICTEMENT POSTÉRIEUR dans une liste ordonnée qu'elle tient elle-même.**

| Existant | Entrant | Verdict |
|---|---|---|
| `moteur-inventaire-v1` | un extracteur de modèle | **remplacée** (ADR 0006, inchangé) |
| `haiku-4.5-piece-v1` | `haiku-4.5-piece-v2` | **remplacée** (ce qui est neuf) |
| `haiku-4.5-piece-v2` | `haiku-4.5-piece-v1` | `dejaPresentes` — on ne redescend pas |
| `haiku-4.5-piece-v1` | `haiku-4.5-piece-v1` | `dejaPresentes` — rien à gagner |
| un extracteur inconnu de la liste | n'importe quoi | `dejaPresentes` — **jamais écrasée** |

La liste (`LIGNEE_EXTRACTEURS`) vit **ici**, jamais dans le lot reçu.

### Pourquoi ça ne rouvre aucune des deux portes fermées

- **Aucune auto-évaluation.** La `confiance` ne décide toujours rien. Un modèle ne peut pas
  se déclarer meilleur : seul un rang dans une liste que MemoryAI tient compte.
- **Aucune chronologie.** Une seconde lecture par la MÊME version reste `dejaPresentes` : le
  cas « la plus récente gagne » n'est jamais atteint. Une relecture exige qu'un humain ait
  bumpé le tag dans les deux dépôts — un geste qu'on ne fait pas par accident.
- **L'appelant ne peut pas s'auto-autoriser.** DriveAI qui annoncerait `…-v9` sans que
  MemoryAI connaisse ce nom se voit refuser : un nom hors liste ne remplace rien. C'est la
  différence entre une permission POSÉE et une permission DEMANDÉE.
- **Rien n'est détruit.** L'ancienne ligne garde le traitement du §3 de l'ADR 0006 : statut
  `remplacee`, `remplaceId` posé, empreinte cédée. L'effacement silencieux que l'ADR 0006
  redoutait n'existe pas — une relecture ratée se compare à l'ancienne, qui est toujours là.

---

## 4. Ce que cet ADR n'autorise toujours pas

- **Pas de relecture automatique.** Rien ne relit un papier tant qu'un tag n'a pas été bumpé.
- **Pas de suppression.** Aucun chemin ne retire une ligne.
- **Pas d'élargissement du droit d'écriture.** Mêmes jetons, mêmes périmètres, même
  `validerPiece`.
- **Pas de rattrapage du passeport de Marc.** Et il faut le dire, parce que c'est lui qui a
  déclenché cet ADR : son OCR ne porte aucune information, donc **aucune relecture ne peut
  rien en tirer**. Ce papier se répare par une meilleure PHOTO, pas par un meilleur prompt.
  Ce que l'amendement rattrape, ce sont les papiers dont l'OCR est bon et dont la lecture a
  été faite sous un prompt plus pauvre.

---

## 5. Le geste, quand on voudra relire

1. Améliorer le prompt d'extraction dans DriveAI.
2. Bumper `PIECE_EXTRACTEUR` (DriveAI) **et** ajouter le nouveau nom en queue de
   `LIGNEE_EXTRACTEURS` (MemoryAI) — les deux, sinon rien ne remplace.
3. Bumper le tag de campagne (`RATTRAPAGE_PIECE_TAG`) pour que les papiers déjà « faits »
   soient re-présentés.

⚠️ Le point 2 est la friction, et c'est elle le garde-fou : une relecture coûte un appel de
modèle par document. La rendre facile la rendrait involontaire.
