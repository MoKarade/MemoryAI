# ADR 0017 — LIA vit dans MemoryAI, le hub exécute

- **Statut** : **ACCEPTÉ** — décision 5 de Marc, 22/10/2026 à 19:30Z (liste unique des onze décisions
  du plan LIA). Rédigée par le fil Assistant (`commun/assistant/ADR-maison-de-lia.md`), versée ici
  par le fil MemoryAI comme elle le demandait (MemoryAI#96).
- **Remplace** la piste de Hubperso#297 « cerveau côté Hubperso » (plan du 21/10/2026).
- **Aval** : ADR 0016 (la route par laquelle le hub interroge LIA).

## Contexte

LIA est l'assistant commun à toutes les apps : un seul, identique partout. Il doit tout savoir sur
Marc, répondre avec citation, apprendre en continu, proposer des actions dans les apps, et vivre
sous un plafond de 20 $ par mois pour toutes les IA. Trois pistes existaient : le hub, MemoryAI,
un service à part.

## Décision

- Le **cerveau** (appel du modèle, outils de recherche, réseau de comportement, relances, journal)
  tourne dans MemoryAI, à côté des données. Elles ne partent vers aucun service de plus.
- **Hubperso** reste l'interface commune et le seul détenteur des jetons des apps.
- LIA **propose** une action ; Hubperso l'**exécute**. Catalogue d'actions : hub-contract#78.
  Niveaux : N1 direct, annulable 10 s ; N2 aperçu puis jeton de confirmation à usage unique ;
  N3 (argent, objet physique) lecture seule.
- MemoryAI ne détient **aucun jeton** vers une app ni vers Google. La règle du dépôt tient.
- LIA ne répond **qu'au propriétaire**, jamais aux invités des apps (tenu par `proprietaire: true`,
  ADR 0016 §2).

## Pourquoi pas les autres

- Cerveau dans le hub : il faudrait y recopier la mémoire chiffrée ou l'interroger à chaque
  question (latence, deux copies de la vérité, surface d'attaque plus large).
- Service à part : un secret et un coût de plus, une troisième frontière à garder, rien que
  MemoryAI ne fasse déjà.

## Conséquences

- Le contenu des apps, des courriels et des messages est une **donnée**, jamais une consigne : LIA
  ne déclenche aucune action parce qu'un texte le demande.
- Une action ne part que par le hub, avec la session et l'accès du propriétaire revérifiés.
- Coût : plafond mensuel de 20 $ en limite dure, 3 $ par jour en garde-fou de pointe
  (`PLAFOND_TOTAL_USD_PAR_JOUR`), cible de 4 cents par question en moyenne, 2 $ par mois fixes pour
  la vie propre de LIA. Toujours les dernières versions des modèles.
- Le réseau de comportement appris sur la vie de Marc (décision 9, option C) est dérivé de la base
  de MemoryAI et réentraîné depuis elle : un fait oublié disparaît au prochain entraînement.
- Tables journal quotidien et boîte à idées dans MemoryAI (lot 4 du plan MemoryAI).

## À vérifier

- Latence et coût réels par question : à mesurer sur la route de l'ADR 0016 une fois le hub branché.
- Les limites de la frontière hub / MemoryAI sous attaque (injection par un message reçu) : testées
  par le banc de scénarios, pas encore écrit.

Sources : plan LIA https://claude.ai/artifact/GYPmaFBG46skpc86zAV2Si (onze décisions) ; plan
MemoryAI https://claude.ai/artifact/FjSqJYh6apLY8CPbwrRivY.
