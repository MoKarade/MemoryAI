# ADR 0024 — LIA lit la météo et l'actualité, de sources publiques gratuites et sans clé

- **Statut** : **proposé** (24/10/2026, fil MemoryAI). Il applique la demande de Marc du 24/10/2026
  (18:41Z : « activer tous ses outils, toutes ses fonctionnalités, la météo, l'actu et tout le
  reste ») et sa règle du 19/10 (zéro coût, aucune API payante). Tâche : MemoryAI#189. Code
  livré après le « Fais tout » de Marc (24/10/2026 19:21Z, fil Assistant), la météo d'abord.
- **Codé, la météo (24/10/2026)** : `lib/monde/meteo.ts`, table `monde_cache` (migration 0029),
  outil `monde_meteo` dans `lib/chat/agent.ts` (chat et hub, hors du MCP), tuiles « Météo »,
  « Sept jours » et « Sources » de l'espace Monde. La ville est le réglage `MEMORYAI_METEO_VILLE`
  (identifiant ECCC, niveau 0, absent : « météo non réglée »). L'actualité suit dans une autre PR.
- **Vérifié (24/10/2026)** : la licence d'ECCC
  ([eccc-msc.github.io/open-data/licence](https://eccc-msc.github.io/open-data/licence/readme_fr/))
  permet tout usage légitime, exige « Source des données : Environnement et Changement climatique
  Canada » et la reproduction des alertes sans en changer le sens. Les fils RSS de Radio-Canada
  ([ici.radio-canada.ca/rss](https://ici.radio-canada.ca/rss)) sont permis pour un usage personnel.
- **Amont** : ADR 0016 (outils de LIA en liste blanche), 0005 (LIA parle juste) ; les tuiles
  « Météo » et « Le monde » de l'accueil, dessinées vides faute de source.

## Contexte

Ce qui entre ici ne vient pas de Marc : c'est le MONDE. Rien n'en sort vers l'extérieur (aucune
donnée de Marc dans la requête, sauf une ville), mais tout ce qui en revient est du texte écrit par
un tiers, donc un canal d'injection, comme une offre d'emploi ou un courriel.

## Décision

1. **Météo** : Environnement et Changement climatique Canada, `api.weather.gc.ca` (collection
   `citypageweather-realtime` : conditions, prévisions, alertes). Officielle, gratuite, sans clé.
   [Probable] licence ouverte d'ECCC, mention de la source exigée ; [À vérifier] avant le code.
   Écartée : Open-Meteo, dont les conditions préviennent que les hébergeurs comme Vercel atteignent
   la limite plus tôt.
2. **Actualité** : des fils RSS publics, LISTE FERMÉE posée par Marc, sans clé.
   [À vérifier] les conditions de chaque fil avant de l'ajouter (Radio-Canada n'a pas encore été
   confirmée) ; un fil dont les conditions interdisent l'usage est écarté.
3. **Deux outils en lecture**, `monde_meteo` et `monde_actualite`, dans la liste blanche de LIA
   (chat et hub). La ville vient d'un réglage de Marc (niveau 0), jamais d'un fait N2 : son
   adresse ne part jamais dans une requête.
4. **Ce qui revient est une DONNÉE** : titres et résumés coupés (200 caractères), balisés
   `<monde>`, jamais suivis d'un lien ouvert par le serveur ; `estCanari` sur chaque titre, et le
   titre marqué est retiré, compté. Aucun fait n'est créé à partir du monde.
5. **Cache et sobriété** : une lecture toutes les 30 minutes au plus par source (cache en base),
   délai de 5 s, et une source en panne dit « indisponible » (jamais une météo d'hier présentée
   comme celle d'aujourd'hui : chaque bloc porte son heure).
6. **Les tuiles** « Météo », « Sept jours » et « Le monde » se remplissent par les mêmes outils ;
   vides et dessinées tant que la source ne répond pas.

## Ce qui reste ouvert

- La liste des fils d'actualité, et la ville de la météo : à choisir par Marc.
- [À vérifier] les conditions d'ECCC et de chaque fil, citées dans cet ADR avant le code.
