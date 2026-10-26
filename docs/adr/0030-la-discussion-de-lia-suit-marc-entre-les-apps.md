# ADR 0030 — La discussion de LIA suit Marc d'une app à l'autre, chiffrée, par l'état partagé

- **Statut** : **accepté** (OK de Marc, 26/10/2026 17:04Z, carte « Oui, tel quel »). Il répond à la carte de
  Marc du 26/10 à 13:12Z (« Garder la discussion entre apps » : « Oui, via MemoryAI »). Tâche : MemoryAI#263.
  Le protocole de la frontière des données (`docs/claude/11-protocole.md`) est suivi : cet ADR d'abord, le code ensuite.
- **Amont** : ADR 0016 et 0017 (LIA vit dans MemoryAI, le hub exécute), le contrat de l'état
  partagé (`commun/assistant/CONTRAT-etat-lia.md`, migration 0025) et le paquet `@mokarade/lia-ui`
  (champ `EtatLia.discussion` depuis v0.39.0, bornes posées par lia-ui#128).

## Contexte

Relevé du PC (26/10/2026) : la discussion de Marc avec LIA ne suit pas d'une app à l'autre. Du hub
vers CarAI, deux messages deviennent zéro. `lia_etat` ne garde aujourd'hui que des nombres, des
verbes de LIA et un nom d'humeur : la règle de son contrat est « aucun contenu de Marc ». Une
discussion est un contenu de Marc.

## Décision

1. **Où.** Une colonne `discussion` (texte, vide par défaut) s'ajoute à `lia_etat`, par une
   migration additive qui ne touche à aucune ligne (0034). Le JSON `etat` ne porte JAMAIS la
   discussion : l'écriture la retire de l'objet avant de le poser, la lecture la lui remet.
2. **Chiffrée, niveau 2.** La valeur est le JSON `{ ouvert, quand, msgs }`, chiffré avec la clé de
   l'app et une donnée associée propre à cette ligne (`lia_etat|discussion`, niveau 2). Une ligne
   illisible n'est jamais rendue : la lecture rend l'état sans discussion, et le journal serveur le
   dit sans citer de texte.
3. **Bornes.** Une seule définition : `validerEtat` du paquet (lia-ui ≥ v0.39.0 : 20 messages, 600
   caractères chacun, 4 000 au total). MemoryAI ne les recopie pas : à la lecture, la discussion
   déchiffrée repasse par `validerEtat`. La porte garde sa limite de 16 Ko, qui compte la
   discussion comme le reste du corps.
4. **Qui.** Les deux portes existantes, sans nouvelle route : `/api/lia/etat` (session de Marc) et
   `/api/etat-lia` (jeton du hub ET `x-lia-proprietaire: 1`). Jamais un invité d'une app.
   `GET /api/etat` ne rend toujours que des nombres.
5. **Une donnée, pas une consigne.** Ce lot ne donne la discussion à aucun modèle : elle ne fait que
   suivre l'écran. Le paquet l'affiche par `textContent`. Si un tour de chat la relit un jour, ce
   sera balisé comme une donnée, et ce sera un autre ADR.
6. **Ce qui l'efface.**
   - Une discussion fermée (`ouvert` faux) ne garde AUCUN texte : le paquet la renvoie avec `msgs` vide,
     et la colonne ne porte que cette marque (`ouvert`, `quand`), pour qu'elle ne se rouvre pas dans
     une autre app. *Précision du 26/10, au codage : la première rédaction disait « vide la colonne » ;
     vider la colonne perdrait le signal de fermeture, et la marque ne contient rien de Marc.*
   - Un état écrit sans discussion vide la colonne : l'hôte qui ne la connaît pas ne la fait pas
     survivre.
   - [À vérifier] « Oublie tout » : cette commande n'existe pas dans MemoryAI aujourd'hui. Quand
     un chemin d'oubli existera (Hubperso#450 pour les demandes), il vide aussi cette colonne.
7. **`oublis` ne s'applique pas ici**, et c'est dit : la table `oublis` garde des valeurs de FAITS,
   et la discussion n'est pas un fait. Rien dans ce lot n'extrait un fait d'une discussion.
8. **Une seule discussion.** Une ligne, remplacée à chaque écriture acceptée : l'ordre des versions
   de l'état (409 sur une version qui ne dépasse pas) vaut aussi pour elle. Aucun historique.
9. **Sans clé de chiffrement**, l'état marche et la discussion ne se lit ni ne s'écrit : la colonne
   n'est pas touchée, la réponse ne la rend pas. Rien n'est stocké en clair pour compenser.

## Ce qui reste ouvert

- Le chemin d'oubli complet (Hubperso#450) : la colonne s'y branchera quand il existera.
- Que LIA relise la discussion pour répondre mieux : un autre ADR.
- Le re-pin de `@mokarade/lia-ui` (v0.41.0, qui contient les bornes de v0.39.0) se fait avec le code,
  à la main : le lockfile ne se régénère pas depuis une session sans shell.
