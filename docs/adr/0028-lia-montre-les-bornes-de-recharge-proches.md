# ADR 0028 — LIA montre les bornes de recharge proches de ta ville, d'après le fichier ouvert du Circuit électrique

- **Statut** : **accepté** (26/10/2026). Il répond à la demande de Marc du 25/10 à 20:21Z
  (« Jveux tout ça », capture « Monde, Bornes proches »). Tâche : MemoryAI#234. OK de Marc le
  26/10/2026 à 13:07Z (« Oui, tout, dans cet ordre »), selon le protocole
  (`docs/claude/11-protocole.md`).
- **Amont** : ADR 0024 (la météo et l'actualité, même patron : source publique, gratuite, sans clé,
  cache en base, panne dite).

## Contexte

L'espace « Monde » a une tuile « Bornes proches » vide : « Aucune source de bornes de recharge
branchée ». La règle du projet : aucune donnée scrapée, zéro coût, aucune donnée de Marc qui sort.

## Options (lues sur place le 25/10/2026)

1. **Le fichier ouvert du Circuit électrique** (recommandée). Il est publié sur Données Québec
   (« Liste des bornes de recharge », licence CC BY 4.0).
   - **Accès** : un CSV à `data.lecircuitelectrique.com/stations/export_sites_fr.csv`, sans clé. Le
     fichier fait environ 1,6 Mo et 7 360 lignes ; l'en-tête `Last-Modified` le dit régénéré chaque
     jour (24/10/2026, 06:00Z).
   - **Colonnes** : nom de la borne et du parc, adresse, ville, région, niveau de recharge,
     latitude, longitude, coût, mode de tarification, puissance (kW).
   - **Limites** : le réseau du Circuit électrique seulement (ni Tesla, ni FLO, ni les autres). Le
     fichier ne donne pas la disponibilité en direct.
2. **L'API de NREL** (Alternative Fuel Stations, Canada compris). Elle couvre tous les réseaux,
   mais demande une clé (`developer.nrel.gov`), donc un secret à garder, et ses conditions
   actuelles n'ont pas pu être lues.
3. **Open Charge Map**. Tous réseaux, données sous CC BY 4.0, mais une clé est exigée en
   production, et chaque borne peut porter la licence de sa propre source, à vérifier une par une.

## Décision (option 1)

1. **Une seule source dans ce lot** : le CSV du Circuit électrique, téléchargé côté serveur, sans
   clé et sans paramètre. **Rien de Marc ne part** : la requête ne porte ni position, ni ville, ni
   jeton.
2. **La position de référence est celle de la ville de la météo.** C'est le point que rend ECCC
   pour `MEMORYAI_METEO_VILLE` (la `geometry` de la réponse déjà lue, centre de la ville), jamais
   une adresse. La position réelle du véhicule (CarAI) n'est pas utilisée : elle ferait entrer dans
   MemoryAI un déplacement de Marc, et la ville suffit pour « proches ».
3. **Le calcul est pur et local** : la distance (haversine) de chaque borne au point de la ville,
   puis les 5 plus proches dans un rayon de 25 km. Les bornes d'un même parc sont regroupées sur
   une ligne (« 2 bornes »). Les lignes du CSV sont bornées et validées : coordonnées dans les
   limites, textes coupés, sans balise, et tout champ hors forme est ignoré.
4. **Le cache** garde le résultat (les 5 lignes), pas le fichier. Clé : `bornes|<lat>,<lon>`
   (le point de la ville, arrondi au centième) dans `monde_cache`. Une lecture par jour au plus,
   avec un délai de 10 secondes. Une panne ou une forme inattendue rend « Le Circuit électrique ne
   répond pas » et se compte dans le journal.
5. **La tuile** montre une ligne par parc :
   - le nom du parc, la distance (« à 1,2 km »), le niveau et la puissance (« Niveau 2, 7,2 kW ») ;
   - la date du fichier ;
   - l'attribution exigée par la licence (« Source : Le Circuit électrique, Données Québec,
     CC BY 4.0 »), aussi dans la tuile « Sources ».

   Le coût n'est pas affiché : son unité dépend du mode de tarification, et un tarif mal lu serait
   un faux chiffre. Les autres réseaux manquent, et la tuile le dit (« Réseau du Circuit électrique
   seulement »).
6. **Rien ne sort vers un modèle dans ce lot.** Si LIA lit un jour les bornes (outil
   `monde_bornes`), ce sera balisé comme `<monde>` (ADR 0024) : un nom de parc est une DONNÉE.

## Tel que codé

- `lib/monde/bornes.ts` : la lecture du CSV, les parcs proches et la source avec son cache.
- `lib/monde/meteo.ts` : `position` (facultative) lue dans la `geometry` d'ECCC ; un météo déjà en
  cache avant ce lot n'en a pas, et la tuile dit « la ville de la météo n'a pas de position » jusqu'à
  la prochaine lecture d'ECCC (30 minutes au plus).
- `lib/accueil/tuileBornes.ts` : la tuile, posée sur le tableau du monde par la page.

## Ce qui reste ouvert

- Les autres réseaux : l'option 2 ou 3, avec une clé gratuite, si Marc le demande.
- Le rayon de 25 km et les 5 lignes sont des choix par défaut, réglables.
