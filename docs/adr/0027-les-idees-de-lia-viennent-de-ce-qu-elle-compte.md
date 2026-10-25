# ADR 0027 — Les idées de LIA pour tes apps viennent de ce qu'elle compte, pas d'un modèle

- **Statut** : **proposé** (25/10/2026, fil MemoryAI). Il répond à la demande de Marc du 25/10 à
  20:21Z (« Jveux tout ça », capture de l'espace « Idées »). Tâche : MemoryAI#233. Le code attend
  l'OK de Marc (protocole, `docs/claude/11-protocole.md`).
- **Amont** : ADR 0021 (les demandes du hub), ADR 0001 (frontière, oublis), ADR 0026 et son
  amendement du 25/10 (Marc ne juge plus rien).

## Contexte

L'espace « Idées » a quatre tuiles vides : la boîte à idées, « Où elles en sont », « Utilité
estimée » et « Refusées, jamais reproposées ». La tâche demande de vraies idées, tirées de ce que
LIA observe, sans en inventer, avec un état suivi et une utilité estimée qui se dit estimation.

Ce que MemoryAI observe réellement aujourd'hui est court :

- les **demandes** « Que peut-on changer ici ? » du hub (ADR 0021), bornées : une app, un genre,
  un nom de 80 caractères au plus, une date ;
- ses propres journaux : lectures, appels au modèle, relectures. Ils disent ce qu'elle fait, pas
  ce qui manque à une app.

MemoryAI ne lit pas les résumés des apps (c'est le hub qui les lit) et ne garde pas leurs erreurs.
« Erreurs récurrentes » n'a donc pas de source ici aujourd'hui.

Une idée écrite par un modèle à partir de textes d'apps ouvrirait une porte d'injection : le nom
d'une demande est une DONNÉE (ADR 0021 §3) et ne doit pas devenir une consigne.

## Options

1. **Des règles sur des comptes, sans modèle** (recommandée). Une idée naît d'un signal compté.
   Son texte est un gabarit du code, dans lequel le nom de la demande entre comme valeur citée.
   Coût nul. Rien n'est écrit par un modèle, donc rien n'est inventé. La limite : les idées sont
   simples (« tu as demandé trois fois de changer telle tuile »).
2. **Un modèle (Haiku) qui rédige à partir des comptes**. Les idées seraient plus riches, mais un
   modèle peut broder au-delà du signal. Il faudrait le baliser, le valider par Zod et lui ouvrir
   un poste de budget. Cela reste possible plus tard, au-dessus de l'option 1.
3. **Ne rien faire tant que le hub ne pousse pas les erreurs des apps**. La tuile resterait vide.

## Décision (option 1)

1. **Une table `idees`** (migration additive). Colonnes : `id`, `regle` (enum fermé), `app` (liste
   du parc), `cible` (le nom de la demande, chiffré au niveau 1 comme dans `demandes`),
   `empreinte` keyée `(regle, app, genre, nom)` et unique, `etat`, `utilite` (entier de 0 à 100),
   `raisons` (codes fermés et nombres, jamais du texte libre), `issue` (adresse GitHub, ou rien),
   `creeLe`, `majLe`.
2. **Une seule règle pour commencer : la demande répétée.** La même demande (même app, même genre,
   même nom) faite au moins deux jours différents sur 30 jours devient une idée : « Revoir le
   {genre} « {nom} » dans {app} : tu l'as demandé {n} fois ».
3. **L'utilité estimée vient d'un calcul pur et se dit estimation.** Elle croît avec le nombre de
   jours où la demande revient et décroît avec le temps depuis la dernière. La tuile écrit toujours
   « estimation » et donne ses raisons (« 3 jours sur 30, la dernière il y a 2 jours »). Aucun
   chiffre ne vient d'un modèle.
4. **Les états** :
   - `proposee` : posé par la règle ;
   - `retenue` : sur un geste de Marc seulement ;
   - `faite` ou `ecartee` : quand l'issue liée est fermée (`completed` donne `faite`, sinon
     `ecartee`), ou sur un geste de Marc.

   **Marc ne juge rien** : LIA propose et classe seule par l'utilité. Retenir est un choix d'action,
   pas un verdict sur une déduction.
5. **Retenir n'écrit rien sur GitHub.** MemoryAI ne tient aucun jeton GitHub. Le bouton « En faire
   une tâche » ouvre la page « nouvelle issue » du bon dépôt, pré-remplie. C'est Marc qui la crée
   sous son compte, après l'avoir lue. Le texte pré-rempli ne contient que le gabarit, l'app, le
   genre et le nom, pas de donnée perso : la plupart des dépôts sont publics.
6. **Le suivi lit l'état public de l'issue.** Une fois par jour au plus, dans la passe
   d'apprentissage, MemoryAI lit l'état de l'issue liée par l'API publique de GitHub, sans jeton
   (`state`, `state_reason` et rien d'autre). Un dépôt privé (DriveAI) répond 404 : l'état reste
   celui qu'il était, et la tuile le dit (« suivi impossible : dépôt privé »).
7. **Écartée, jamais reproposée.** Une idée écartée garde son empreinte : la règle ne la recrée
   pas, même si la demande revient. Oublier une demande (ADR 0021 §5) retire aussi l'idée qui en
   vient, et `oublis` est consulté avant toute insertion.
8. **Rien ne sort vers un modèle.** Les idées s'affichent sur l'accueil de Marc (`requireSession`).
   Elles n'entrent dans aucun prompt dans ce lot ; si elles y entrent un jour, ce sera balisées,
   comme les demandes.

## Ce que montre l'espace « Idées »

- **Boîte à idées** : les idées `proposee` et `retenue`, la plus utile d'abord, avec leur source
  (« tes demandes du hub ») et le bouton « En faire une tâche ».
- **Où elles en sont** : le compte par état.
- **Utilité estimée** : une barre par idée, étiquetée « estimation », avec ses raisons.
- **Refusées, jamais reproposées** : les idées écartées.
- **Aucune idée** : « Aucune idée : tu n'as encore rien demandé deux fois au hub. » C'est l'état
  vide honnête.

## Ce qui reste ouvert

- [À vérifier] Le nombre de demandes en production. S'il est nul, l'espace restera vide jusqu'aux
  premières demandes du hub (Hubperso#450).
- Les erreurs récurrentes des apps : il faudrait que le hub pousse un compte par app (un autre ADR,
  côté Hubperso).
- Une rédaction par un modèle (option 2), si Marc trouve les gabarits trop secs.
