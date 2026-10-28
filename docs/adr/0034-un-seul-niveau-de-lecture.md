# ADR 0034 — Un seul niveau de lecture : tout est accessible, à Marc seul

- **Statut** : **accepté** (Marc, 28/10/2026 21:40Z : « pour la mémoire on va enlever tous les niveaux. Tout sera au même niveau. Tout sera accessible et disponible bien sûr. Je veux que […] ce soit 100 % privé à moi » ; carte du 21:42Z, option « Un seul niveau, toi seul »). Code à venir. Mission MemoryAI#431, tâches #432 à #435.
- **Amende** : l'ADR 0001 § 5.3 (les niveaux comme niveaux d'ACCÈS), l'ADR 0007 « Le contenu des papiers d'identité peut sortir, sous deux verrous » (les deux verrous), l'ADR 0011 (la liste fermée des lecteurs du niveau 3) et l'ADR 0033 avenant A3 (le niveau plancher 2 d'un fait retenu par LIA). Ne touche ni au contrat d'écriture, ni au vocabulaire, ni à la quarantaine, ni au chiffrement au repos.
- **Amont** : ADR 0001 (frontière, garde-fous), ADR 0016 (`proprietaire: true` obligatoire sur la route du hub), ADR 0015 (un jeton dit qui écrit).

## Contexte

Aujourd'hui la mémoire sépare ce qu'on lit de ce qu'on peut servir :

- quatre niveaux d'accès, de 0 à 3, posés sur chaque fait et chaque papier ;
- deux verrous pour dépasser le niveau 1 : une variable d'environnement (`MEMORYAI_N2_CHAT`, `MEMORYAI_N3_CHAT`) ET une demande par appel (`inclure_n2`, `inclure_n3`) ;
- une liste fermée de lecteurs du niveau 3 (`LECTEURS_N3 = {"chat"}`, ADR 0011) : claude.ai, par le MCP, ne reçoit que le sommaire d'un papier d'identité, quoi qu'il demande ;
- un seul point qui décide, `politique()` (`lib/lecture.ts`).

Marc a choisi de tout supprimer, y compris pour claude.ai, en gardant la mémoire chez lui : Neon et Vercel, chiffrée, lisible par lui seul.

## Décision

1. **Plus aucun niveau d'ACCÈS.** Ce que la mémoire sait se lit partout où Marc la lit : le chat de MemoryAI, LIA (dans sa maison et par le hub), claude.ai par le MCP. Disparaissent : `MEMORYAI_N2_CHAT`, `MEMORYAI_N3_CHAT`, les paramètres `inclure_n2` et `inclure_n3` des outils, `LECTEURS_N3`, les bascules des écrans, et le plancher 2 de la voie A de l'ADR 0033.
2. **L'accès reste au propriétaire seul, et c'est la seule porte.** Session du hub vérifiée pour les pages et le chat ; jeton OAuth du propriétaire pour le MCP de claude.ai ; `proprietaire: true` sur la route du hub (ADR 0016) ; jamais d'invité. Un jeton d'application garde son rôle et son périmètre (ADR 0015) : ce qu'une app lit ou écrit reste borné par son jeton. La tâche #432 dresse l'inventaire route par route et prouve cette porte AVANT qu'un verrou de niveau tombe.
3. **Le chiffrement au repos ne bouge pas.** La colonne `niveau` reste en base, mais elle ne dit plus QUI peut lire : elle dit sous quel régime la ligne est écrite (en clair au niveau 0, chiffrée au-dessus, `niveau` dans l'AAD). Aucune migration, aucun rechiffrement, rien n'est reclassé.
4. **Les gardes d'écriture restent**, parce qu'elles protègent contre un faux, pas contre un lecteur : le canari, `oublis` consulté d'abord, aucun montant, aucun numéro d'identité dans un fait texte (`n3_texte`, contrainte `faits_n3_sans_texte`), et la validation par Marc des faits d'identité (l'ADR 0033 ne les valide jamais seuls) tant qu'il n'a pas dit le contraire.
5. **Le journal d'accès continue.** Chaque lecture reste tracée dans `acces_journal` (append-only, HMAC chaîné). La colonne `niveauMaxServi` n'a plus de sens comme plafond ; la tâche #434 fixe ce qu'on y écrit sans casser la chaîne.

## Ce que ça coûte, dit une fois

- **Tout ce que LIA ou claude.ai lisent pour répondre part chez Anthropic, en clair pour le modèle** : passeport, numéro d'assurance, santé, domicile, numéros compris. L'ADR 0011 § 3 le disait déjà du chat, qui lisait le niveau 3 par défaut ; cela vaut maintenant aussi pour claude.ai. « 100 % privé » veut dire « accessible à Marc seul », jamais « qui ne quitte jamais la base ».
- **Le verrou contre l'injection côté MCP disparaît.** L'ADR 0011 § 1 l'a mesuré : le MCP s'authentifie par un jeton, et la demande `inclure_n3` y était à la main d'un modèle. Un claude.ai qui aurait lu un texte piégé peut désormais LIRE ce qu'il ne lisait pas, et le dire à qui il parle ou le passer à un autre connecteur de Marc. Les freins qui restent : seul le propriétaire connecte claude.ai, le journal trace chaque lecture, `MEMORYAI_GEL=1` coupe tout. Marc a écarté l'option « un seul niveau, sauf l'identité pour claude.ai », qui gardait ce verrou-là.
- **La condition posée à la rétention Anthropic tombe avec le verrou** (ADR 0001, Q5 : Marc ne posait `MEMORYAI_N2_CHAT` qu'après avoir lu la console). [À vérifier par Marc] : le réglage de rétention de la console Anthropic, qui n'est plus un préalable mais reste ce qui dit combien de temps ce qui part est gardé.

## Ce qui reste ouvert

- **« Pas en ligne »** : la carte du 21:42Z disait que les données restent sur Neon et Vercel, chiffrées, lisibles par Marc seul, et il a choisi cette option. Reste une question que la carte ne posait pas : le dépôt MemoryAI est public (code et données fictives seulement). Le rendre privé ne change rien à l'accès aux données ; à demander à Marc, pas à décider ici.
- **Les jetons d'application** : si l'un d'eux tient son périmètre d'un niveau, #432 le dit et sa suite est tranchée à part.

## Découpage du code

1. **#433** — cet ADR, son numéro dans `docs/adr/NUMEROS.md`, `docs/INDEX.md`, et la mention d'amendement dans les ADR 0001, 0007, 0011 et 0033.
2. **#432** — l'inventaire : `tests/accesRoutes.test.ts` (chaque route classée dans une table fermée, une route non classée fait rougir) et `docs/ACCES.md`. Avant toute suppression de verrou.
3. **#434** — la lecture sans niveau : `politique()`, les outils MCP, le chat, LIA, les tests `niveau3Lecteurs` réécrits en garde de l'accès propriétaire. Après #432 et après la PR de `/chat` en atelier (MemoryAI#367), qui touche la même zone.
4. **#435** — les écrans sans niveau : les bascules, les étiquettes. Après #434.

L'ordre est la décision : un verrou de niveau est aujourd'hui l'une des deux couches qui protègent un papier d'identité ; on ne retire la seconde qu'après avoir prouvé la première.
