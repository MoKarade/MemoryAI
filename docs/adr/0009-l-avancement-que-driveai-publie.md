# ADR 0009 — L'avancement que DriveAI publie à la Mémoire : des comptes, jamais des faits

- **Statut** : **ACCEPTÉ** — plan validé par Marc le **23/09/2026** (« ok pour le plan
  commence »), après quatre arbitrages en QCM : un onglet **Avancement** dédié ; l'entonnoir, la
  vitesse, le détail par dossier et ce qu'on tire des papiers ; et **« DriveAI pousse ses
  comptes »** plutôt que la Mémoire qui irait les lire.
- **Portée** : ce dépôt (une route, une table, un écran) et son producteur dans DriveAI.
- **Amont** : ADR 0001 (frontière des données, un jeton = une app = un rôle), ADR 0007 (la file
  de lecture — c'est la Mémoire qui sait ce qui est LU).

---

## 1. Le problème

Marc, le 23/09 : « je vais vouloir une interface similaire [à celle de DriveAI] pour dire
l'avancement ». Et avant : « quand j'ai regardé, il manquait des infos à cause du moteur ».

La Mémoire sait ce qu'elle a **reçu** (papiers connus, papiers lus, faits nés de la lecture). Elle
ne sait rien de ce qui se passe **en amont** : combien de documents DriveAI a classés, combien il
a envoyés, dans quel dossier il lit en ce moment, combien de papiers il a essayé de lire sans rien
en tirer. La moitié de l'entonnoir est donc invisible d'ici. L'onglet actuel (Dépenses) ne peut
dire que « tant de lus sur tant de connus ». Or un papier qui n'est jamais arrivé et un papier
arrivé mais pas encore lu donnent la même absence.

`GET /api/etat` (lot du 23/09) a réglé le sens inverse : DriveAI lit les comptes de la Mémoire.
Cet ADR règle le sens qui manque.

## 2. Décision

**DriveAI pousse, à `POST /api/avancement`, un instantané de NOMBRES.** La Mémoire le range tel
quel dans une table à part et l'affiche. Rien d'autre.

### 2.1 Ce qui est poussé (liste FERMÉE, schéma Zod `.strict()`)

| Groupe | Champs | Source chez DriveAI |
|---|---|---|
| **classés** | lignes d'Index, documents distincts (ou `null`), lignes sans fileId, candidats à la lecture | recompte du périmètre (`DriveAI_PIECE_PERIMETRE`) |
| **envoyés** | papiers acceptés par la Mémoire (cumul) | `DriveAI_MEMOIRE_EMIS` |
| **file de lecture** | par dossier : code à deux chiffres, restants, lus, « en cours » | `DriveAI_PIECE_FILE` |
| **lus par jour** | ≤ 60 jours : date, restants (ou `null`), extraits, acceptés, illisibles, sans texte, échecs, tag | l'onglet `HistoriqueImport` |

Plus : `version` (entier, `1`), `mesureLe` (horodatage ISO de la mesure côté DriveAI).

### 2.2 Ce qui ne passe JAMAIS

- **aucun texte libre** : ni nom de fichier, ni émetteur, ni résumé, ni message d'erreur. Les
  seules chaînes acceptées sont des dates (`AAAA-MM-JJ`), des codes de dossier (`^\d{2}$`), un
  horodatage ISO et un tag de campagne (`^[a-z0-9-]{1,32}$`). Le libellé d'un dossier
  (« Carrière ») est posé **par la Mémoire**, depuis une table fermée : un nom venu du réseau
  serait du texte non maîtrisé affiché tel quel ;
- **aucun fait** : rien n'entre dans `faits`, rien ne passe par `validerFait`. Un compte de
  papiers n'est pas une affirmation sur Marc ;
- **rien vers un modèle** : aucun outil MCP, aucun outil du chat, aucun prompt ne lit cette
  table. Un test l'impose : `lib/chat/` et `lib/mcp/` n'importent pas son dépôt ;
- **aucun chiffrement**, et c'est délibéré : ce sont des compteurs de niveau 0. Les chiffrer ne
  protégerait rien et coûterait une clé de plus à faire tourner.

### 2.3 Qui peut pousser

Un jeton **d'écriture** (`MEMORYAI_TOKEN_<APP>_ECRITURE`). Pas de nouveau secret : DriveAI a déjà
le sien. **L'app vient du jeton, jamais du corps** — même règle que `/api/acces` au hub : une app ne
peut pas écrire l'avancement d'une autre. Un jeton de lecture reçoit **401**, indiscernable d'un
jeton faux. La route est déclarée dans `ROUTES_A_AUTH_PROPRE` **et** dans le matcher, sinon DriveAI
recevrait la page de connexion en HTML au lieu d'un JSON (piège n° 1 du squelette).

### 2.4 Ce qui est gardé

**Une ligne par app, écrasée à chaque envoi** (`avancement_sources`, clé = `app_id`). La série
des jours arrive **dans** l'envoi (60 jours au plus), donc la Mémoire n'accumule rien : pas de
table qui grossit, pas de purge à écrire. Une ligne stocke : l'app, `mesure_le` (la mesure),
`recu_le` (l'arrivée, posé par le serveur) et le corps validé.

⚠️ **Deux horodatages, parce qu'ils répondent à deux pannes différentes.** Une `mesure_le`
ancienne avec un `recu_le` récent veut dire que DriveAI envoie un compte figé : son moteur tourne
mais sa mesure est périmée. Un `recu_le` ancien veut dire que DriveAI n'envoie plus rien. L'écran
affiche les deux et alerte au-delà de **2 h** sans envoi, soit quatre envois manqués.

### 2.5 Les refus, chacun distinct

| Cas | Réponse |
|---|---|
| jeton absent, faux, ou de lecture | **401** `non_autorise`, sans détail |
| base non configurée ou injoignable | **503** nommé |
| gel (`MEMORYAI_GEL=1`) | **503** `gele`. Le gel arrête ce qui ÉCRIT, et cette route écrit |
| corps de plus de 32 Ko | **413** |
| schéma refusé | **422**, avec le **chemin** du champ fautif et jamais sa valeur (leçon BatchChef : « un refus NOMME le champ ») |
| version inconnue | **422** `version_inconnue` : la réponse dit que c'est la Mémoire qui est en retard, pas DriveAI qui se trompe |

### 2.6 La cadence

DriveAI pousse **au plus toutes les 30 min**, jamais plus souvent : c'est ce qui rend « 2 h sans
envoi » significatif. Côté DriveAI, l'étape a sa propre constante de budget quotidien, **prise**
sur l'enveloppe de 63 min et jamais ajoutée (règle d'orchestration C28-42).

## 3. L'écran

Un **cinquième onglet, « Avancement »**, placé **après** Parler, pour que `start_url` (dérivé de
`SECTIONS[0]`) ne bouge pas. Il montre :

1. **l'entonnoir**, chaque étage avec sa source nommée (« selon DriveAI », « selon la Mémoire ») :
   classés → envoyés → papiers connus → lus → faits nés de la lecture → validés. Chaque écart
   entre deux étages est **expliqué**, jamais laissé à deviner ;
2. **la vitesse** : documents lus par jour, courbe du reste, estimation **en jours actifs** ;
3. **par dossier** : lus sur connus, et le dossier en cours ;
4. **ce qu'on tire des papiers** : dates, numéros, montants trouvés, faits nés.

Le suivi de la lecture **quitte Dépenses** (décision prise sans OK explicite, annoncée à Marc) :
un même compte affiché à deux endroits finit par dériver, et Dépenses redevient ce que dit son nom.

⚠️ **Un étage non mesuré s'affiche « non mesuré », jamais 0.** Tant que DriveAI n'a rien poussé,
les trois premiers étages disent « DriveAI n'a encore rien envoyé ». Un zéro se lirait « rien
n'a été classé », le plus alarmant des faits, là où la vérité est « personne n'a encore compté ».

## 4. Alternatives écartées

- **La Mémoire lit DriveAI** : il faudrait un jeton vers DriveAI, et la Mémoire ne détient
  **aucun** jeton (ADR 0001). C'est non négociable.
- **DriveAI affiche tout, la Mémoire rien** : déjà fait côté DriveAI (C49-25). Mais Marc veut voir
  l'avancement là où vivent les papiers, et la Mémoire est la seule à savoir ce qui est **lu**.
- **Des faits `systeme.*`** : ils passeraient par le vocabulaire, la quarantaine et les lecteurs,
  jusqu'à un modèle. Un compteur n'a rien à y faire.
- **Une table historisée** : la série existe déjà chez DriveAI (`HistoriqueImport`). En tenir
  une seconde copie ici donnerait deux séries qui divergent au premier bump de tag.
