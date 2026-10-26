# ADR 0029 — L'agenda du jour arrive de DriveAI, par une porte à lui, et ne garde que deux jours

- **Statut** : **proposé** (26/10/2026, fil MemoryAI). Il répond à la demande de Marc du 25/10 à
  20:21Z (« Jveux tout ça », capture « Aujourd'hui »). Tâches : MemoryAI#236 et sa jumelle
  DriveAI#679. Le code des deux côtés attend l'OK de Marc (protocole, `docs/claude/11-protocole.md`) :
  c'est une donnée de Marc qui entre.
- **Amont** : ADR 0001 (frontière, niveaux), ADR 0007 (niveau 3 sous deux verrous), ADR 0015 (jetons
  par app), ADR 0019 (sauvetage).

## Contexte

Le bloc « Aujourd'hui » de « Sa journée » dit « Ton agenda du jour viendra avec l'agenda ». MemoryAI
ne détient aucun jeton Google et n'en demandera pas. DriveAI lit déjà Google pour Marc et pousse à
MemoryAI avec son propre jeton (roté le 24/10).

La seule porte d'événements, `POST /api/evenements`, est faite pour un export Messenger
(`{ source: "messenger", file_id, html }`) : elle lit du HTML et en tire des faits. Un agenda n'est
pas un fait durable : il change chaque jour et n'a de sens que le jour même.

Un titre d'événement est un texte écrit par Marc ou par un tiers (une invitation). Il peut contenir
une donnée de niveau 3 (un rendez-vous médical ou d'immigration) et il peut ressembler à une consigne.

## Options

1. **Une porte à part, `POST /api/agenda`, qui remplace le jour entier** (recommandée). Contrat
   court, validé par Zod. Rien n'est tiré par un modèle.
2. **Étendre `POST /api/evenements` avec `source: "agenda"`**. Une seule porte, mais deux formes de
   corps et deux durées de vie sous le même nom, et le chemin Messenger écrit des faits.
3. **Des faits datés dans `faits`**. Ils entreraient dans les réponses de LIA, l'apprentissage et la
   recherche, alors qu'un agenda périmé est faux le lendemain.

## Décision (option 1)

1. **La porte** : `POST /api/agenda`, hors du middleware de session comme les autres routes machine.
   - Le jeton d'écriture de DriveAI seulement (`MEMORYAI_TOKEN_DRIVEAI_ECRITURE`, ADR 0015) ; tout
     autre jeton → 401.
   - Le gel (`MEMORYAI_GEL=1`) → 503 `memoire_gelee`, comme toute route machine.
   - **Pas de porte de sauvetage** : la table est neuve et n'a aucune ligne de l'ancienne clé, donc
     rien ne peut s'y doubler (ADR 0019 §2).
   - Clé absente → 503 `cle_absente` ; base absente → 503 `base_absente`. Une panne n'est jamais un
     refus.
2. **Le corps** (JSON, 32 Ko au plus, sinon 413) :

   ```json
   {
     "source": "agenda",
     "jour": "2026-10-26",
     "lu_le": "2026-10-26T10:00:00Z",
     "evenements": [
       { "debut": "2026-10-26T13:30:00-04:00", "duree_min": 60, "titre": "Rendez-vous fictif", "journee_entiere": false }
     ]
   }
   ```

   - `jour` : la date du Québec (`AAAA-MM-JJ`), au plus un jour avant ou après la date du Québec à la
     réception, sinon 422 `jour_hors_fenetre`.
   - `lu_le` : l'heure de lecture de Google par DriveAI, ISO, pas dans le futur de plus de 5 minutes.
   - `evenements` : 0 à 50 (au-delà : 422 `trop_d_evenements`). Une liste vide est un envoi valide :
     « rien de prévu ».
   - `debut` : ISO avec décalage. Pour une journée entière, `debut` vaut minuit du jour et
     `duree_min` vaut 1440.
   - `duree_min` : entier de 0 à 1440.
   - `titre` : 1 à 120 caractères, une ligne. MemoryAI retire les balises et les caractères de
     contrôle.
   - **Rien d'autre** : ni lieu, ni invités, ni description, ni lien de visio, ni identifiant Google.
     Une clé en trop est ignorée, et la réponse la nomme dans `ignores`.
   - Un événement hors forme est refusé seul et compté dans `refuses` avec son index et un code
     fermé. Les autres passent.
3. **Un envoi complet remplace le jour** : les événements du `jour` reçus avant sont effacés et
   remplacés dans la même transaction. DriveAI peut renvoyer autant de fois qu'il veut, c'est
   idempotent.
4. **La réponse 200** : `{ jour, recus, ecrits, refuses: [{ index, code }], ignores: [noms de clés],
   remplaces }`. Que des nombres et des codes : aucun titre ne revient.
5. **Le stockage** : une table `agenda` (migration additive) avec `jour`, `debut`, `duree_min`,
   `journee_entiere`, `titre` **chiffré au niveau 2** (AAD `agenda|<jour>|<index>`), `lu_le`, `recu_le`
   et `app`.
   - **Deux jours au plus** : chaque envoi efface les jours antérieurs à la veille. Un agenda n'est pas
     une mémoire ; il ne va ni dans `faits`, ni dans l'apprentissage, ni dans la recherche.
   - `GET /api/etat` rend seulement le compte et `lu_le` du jour, jamais un titre.
6. **L'affichage** : le bloc « Aujourd'hui » de « Sa journée » (page de Marc, `requireSession`)
   liste les événements du jour par heure du Québec, avec le titre, la durée et « lu à HH h MM ».
   - Aucun envoi aujourd'hui : « DriveAI n'a pas envoyé ton agenda aujourd'hui. »
   - Envoi vide : « Rien de prévu aujourd'hui. »
   - Base en panne : « La base ne répond pas : ton agenda n'est pas lisible. »
7. **Rien ne sort vers un modèle dans ce lot.** Si LIA lit un jour l'agenda, ce sera balisé comme une
   donnée (`<agenda>`), et un titre de niveau 3 reste sous les deux verrous de l'ADR 0007.

## Ce qui reste ouvert

- Côté DriveAI : la lecture de l'agenda, son scope Google et le rythme d'envoi (au matin, puis à
  chaque changement), suivis dans DriveAI#679.
- L'agenda de demain dans le bloc, si Marc le veut : le contrat le permet déjà (`jour` = demain).
