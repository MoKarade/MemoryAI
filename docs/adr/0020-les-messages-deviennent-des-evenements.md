# ADR 0020 — Les messages deviennent des événements datés, avec leurs personnes

- **Statut** : **proposé** (24/10/2026, fil MemoryAI). Il applique le plan « LIA : refaire MemoryAI »
  (go de Marc du 22/10/2026, lot 1) et sa décision 1 (les messages des autres entrent aussi). Tâche :
  MemoryAI#70.
- **Amont** : ADR 0001 (frontière, niveaux), 0004 (tout entre), 0015 (le jeton dit qui écrit).

## Contexte

Environ 187 exports Messenger et Facebook dorment dans le Drive comme des fichiers entiers :
aucune question du genre « qu'ai-je répondu à X tel jour » n'a de réponse. Le format a été relevé
le 24/10/2026 sur deux vrais exports (HTML Facebook généré le 18/03/2026) : un message est une
`<section>` avec l'auteur, le texte, la date ; l'heure est écrite dans le fuseau du compte.

## Décision

1. **Une table `evenements`** : un message = une ligne datée (`survenu_le`), son auteur, sa source
   (le fichier Drive et sa position dans l'export). Le texte et le nom du fil sont **chiffrés au
   niveau 2**, jamais déduit du texte (il faudrait le lire pour le classer).
2. **Une table `personnes`** et ses **alias** (`messenger`, plus tard `courriel`) : la même
   personne d'un export à l'autre, reconnue par une clé keyée, nom chiffré. `est_marc` marque le
   titulaire du compte, sans que son nom soit écrit dans le dépôt.
3. **Qui écrit** : `POST /api/evenements`, jeton d'écrivain **de DriveAI seulement** (il tient le
   Drive ; MemoryAI ne détient aucun jeton Google). DriveAI envoie le HTML brut ; la lecture se
   fait ici, en code pur, sans modèle (coût nul).
4. **Idempotent** : `(source_ref, position)` est unique ; relancer l'import ne crée rien.
5. **Oubli** : un papier oublié (`lib/pieces/depotOubli.ts`) emporte ses messages (suppression
   logique), et son empreinte d'oubli bloque tout nouvel import du même fichier.
6. **Rien en clair dehors** : la route et ses erreurs ne rendent que des nombres ; le texte passe
   par le scan de secrets des conversations avant chiffrement.
7. **Une date illisible n'est pas devinée** : le message est écarté et compté.

## Ce qui reste ouvert

- [À vérifier] le fuseau des heures de l'export : lu comme celui de Marc (`lib/fuseau.ts`).
- L'envoi côté DriveAI (son dépôt), puis les questions Messenger du banc (lot 0) et la recherche
  par personne et par date : tâches suivantes de MemoryAI#70.
