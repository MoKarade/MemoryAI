# HANDOVER — MemoryAI

> L'état RÉEL, à lire en premier. Ce qui est décidé vit dans `docs/adr/0001-…`, ce qui reste
> à faire dans `BACKLOG.md`. Ce fichier dit où on en est, et ce qui attend un geste de Marc.

## 🚨 INCIDENT — 23/10/2026 : clés de chiffrement effacées, mémoire sauvée (ADR 0019), clôture à faire

Une synchro Infisical → Vercel a vidé les variables de `memory-ai`, dont `MEMORYAI_CHIFFREMENT` et
`MEMORYAI_JOURNAL_CLE` (503 dès 13:09Z). Le déploiement de 12:37Z (`dpl_6rALo2S7biASr7gytWCoLPGcMA4C`) est le
seul à garder les anciennes clés dans son environnement figé. **Ne jamais le supprimer ni le « Redeploy ».**
- Marc a choisi le sauvetage par re-chiffrement (« option 2 », 23/10 14:54Z) : `docs/adr/0019-sauvetage-par-rechiffrement.md`.
- Nouvelles clés posées par le PC à 19:57Z (Vercel Production sensible + Infisical, projet `memoryai-cles`).
  Elles ne vont JAMAIS dans un Key Schema ni dans une synchro.
- PR #117 fusionnée et en prod (20:40Z) ; sauvetage lancé par Marc : 6 085 lignes rescellées, 0 échec ;
  lecture vérifiée par Marc. Les écritures de faits et de papiers restent fermées (503 `sauvetage_en_cours`)
  jusqu'à la clôture (mot CLORE dans Régler → Sauvetage).
- Variables remises : `HUB_TOKEN` (aligné sur `HUB_TOKEN_MEMORYAI` du hub à 20:58Z), `CRON_SECRET` ;
  `MCP_SIGNING_KEY` et `MCP_ACCESS_KEY` NOUVELLES (21:31Z, PC) : claude.ai doit se reconnecter au connecteur
  MemoryAI avec la nouvelle `MCP_ACCESS_KEY` (lue dans Infisical `memoryai-cles`).
- Reste avant la clôture : jeton DriveAI (`MEMORYAI_TOKEN_DRIVEAI_ECRITURE`) ; anciennes valeurs des deux clés
  encore dans le dossier Infisical `agence/prod/MemoryAI` (à retirer, sur « Autorisé » de Marc au PC).
  Après la clôture : copie des nouvelles clés (ADR 0018).

## 🔨 EN COURS — 22/10/2026 : refonte LIA, MemoryAI devient sa maison (chantier MemoryAI#67)

Go de Marc le 22/10 sur les 11 décisions (plan : https://claude.ai/artifact/FjSqJYh6apLY8CPbwrRivY ; décisions
communes : https://claude.ai/artifact/GYPmaFBG46skpc86zAV2Si). Neuf lots enchaînés, fonctions d'abord (#69 à #77) ;
les anciennes tâches d'écran R3 à R7 (#11 à #15) et #56 sont remplacées par le lot 5.

**Lot 0, le banc de questions (MemoryAI#69).** `lib/banc/banc.ts` (pur) tire 40 questions d'un parc de papiers N0 à N2 :
huit par capacité (extraction, multi-sources, temporel, mise à jour, abstention, soit 20 % d'abstention), les note
(rappel@20, abstention correcte = rien rendu). `lib/banc/passe.ts` fige le banc `papiers-v2` UNE fois, chiffré
(`banc_questions`, AAD `banc|<id>`, migration 0023), puis le mesure au plus une fois par jour avec la recherche plein
texte nourrie des mots-clés (`banc_mesures`, des nombres seulement). Elle tourne au réveil de l'apprentissage, avant la
clé Anthropic : coût nul. `memoryai_etat` rend les comptes et la dernière mesure, jamais une question.
- Le dépôt est public : seuls les gabarits sont versionnés, les questions réelles ne vivent qu'en base, chiffrées.
- Le N3 (identité, santé) n'est pas dans ce banc ; il aura le sien avec le lot 6. Un banc neuf prend un nom neuf
  (`messages-v1`…), jamais celui-ci : les lots suivants se comparent à la mesure de base de `papiers-v2`.
- `papiers-v1` (figé sous la clé retirée le 23/10, ADR 0019) est illisible : le sauvetage n'a pas rescellé
  `banc_questions`, chaque passe échouait au déchiffrement. Ses lignes restent en base, jamais réécrites.
- Verrou : `tests/banc.test.ts` (papiers fictifs).

**Lot 5, l'interface de la maquette v5 (MemoryAI#74), avancé avant les lots 1 à 4** (Marc valide la maquette le 22/10,
« peaufine et ship » ; accord des fils MemoryAI et Assistant). Maquette : https://claude.ai/artifact/Qkp5DzqqPnmkFUVZCT1aE6.
États vides honnêtes tant que les lots 1 à 4 n'ont pas rempli les données. LIA vivante viendra du paquet partagé `lia-ui`
(construit par le fil Assistant, tag épinglé).
- Premier pas : le socle passe **sombre seul**, style du hub (`app/globals.css`, un seul `:root`, police Outfit
  auto-hébergée par `@fontsource-variable/outfit`). Les noms des jetons ne changent pas : `--accent` = indigo du hub
  (LIA et action principale), `--repere` = violet de MemoryAI. Verrous : `tests/theme.test.ts` (sombre seul, WCAG),
  `tests/couleurs.test.ts` (manifeste et barre système = `--bg-systeme`).
- Deuxième pas : le **moteur 3D** du réseau (`lib/graphe3d/`, sans bibliothèque, tout pur) : placement déterministe
  (`disposer.ts`, graine fixe : même mémoire, même nuage), caméra en perspective (`camera.ts`), scène et gestes
  (`scene.ts` : opacités, étiquettes, bascule, élan, clavier) et peinture sur un `Pinceau` (`peindre.ts`, les couleurs
  arrivent des jetons, la transparence par `globalAlpha`). Verrous : `tests/graphe3d*.test.ts`.
- Troisième pas : la **page Mémoire** (`/memoire`, entrée « Mémoire » du menu juste après Lia). Un point par fait
  validé, un centre par domaine, les liens ENREGISTRÉS (`depotLiens.tous`) ; filtres de niveau et recherche, fiche du
  point choisi qui renvoie à `/fait/[id]`. ⚠️ Le réseau ne porte que des prédicats : aucune valeur n'est déchiffrée
  pour le dessiner (`lib/memoire/reseau.ts`, verrou `tests/memoireReseau.test.ts`). Borné à `MAX_NOEUDS_3D`, les
  plus reliés d'abord, le reste compté et dit. Les autres onglets de la maquette (réseau de LIA, apprentissage,
  historique, accès) viennent avec les lots qui produisent leurs données.
- Quatrième pas, en deux PR : **l'accueil devient la maison de LIA** (maquette v5). D'abord ses fondations, pures
  et testées, encore montées nulle part : l'orbite (`lib/accueil/orbite.ts`), le décor, sol en perspective et tapis
  des heures (`lib/accueil/decor.ts`), ce que montre chaque espace (`contenuEspaces`, `lib/accueil/espaces.ts` :
  Budget, Outils, Formes, Idées et Souvenirs ont une source, Santé, Sa journée et Monde le disent vides) et le
  panneau d'un espace ouvert (`components/PanneauEspace.tsx`). Verrous : `tests/accueil.test.ts`,
  `tests/panneauEspace.test.ts`. Puis la maison montée sur `/` (`app/AccueilClient.tsx`) : LIA au centre
  (`lia-ui` montée dans la maison, une seule par page : `LiaMaison` se retire de `/`), les espaces en orbite qui
  s'arrêtent au survol, la pastille « à juger » dans l'en-tête. La conversation complète est revenue à `/chat`
  (section « Parler »). Verrou : `tests/accueilRendu.test.ts`. Le 24/10 (écarts A1 et A6 de la maquette) : l'en-tête
  de l'accueil n'a plus que le logo, « LIA », la pastille et UN bouton à droite, « Mémoire » ; ni menu ni « Parler ».
  La touche `/` ouvre « Parler », jamais dans un champ (`lib/accueil/raccourcis.ts`, verrou `tests/accueilRaccourcis.test.ts`) ;
  les autres sections passent par la Mémoire (son menu) et les liens des espaces.
  Écart A3 : LIA salue selon l'heure de Québec à l'arrivée (les quatre saluts de la maquette) et dit seule ce que les
  espaces disent de vrai (« N à juger », dépense du jour et plafonds), à tour de rôle ; rien d'autre
  (`lib/accueil/paroles.ts`). Chaque espace porte `data-lia-cible`, `data-lia-dit` (sa phrase, `ContenuEspace.dit`) et
  `data-lia-activite` (le geste de la maquette) : elle va le voir et le dit. Verrou : `tests/accueilParoles.test.ts`.
  Écart A7 : toucher LIA (`surToucher`, lia-ui v0.33.0) ou `/` ouvre le panneau « Parler » de la maison : accueil, fil,
  huit suggestions vraies, saisie ; même route que la bulle, échec fermé (`lib/accueil/conversation.ts`,
  `components/ConversationMaison.tsx`, verrou `tests/conversationMaison.test.ts`) ; `/chat` reste la conversation complète.
  Écart B (tuiles des panneaux) : Monde et Idées ont les tuiles de la maquette, vides tant qu'aucune source ne les
  remplit (`lib/accueil/tableaux.ts`, `components/TableauEspace.tsx`, verrou `tests/tableauxMaison.test.ts`).
  Outils aussi : vrais comptes (outils, appels du mois de Québec par outil, `lib/accueil/depotAccueil.ts`), un tiret
  pour « refusés à tort » que rien ne mesure, familles vides honnêtes hors Lire et Afficher.
  Budget aussi : anneau du jour par poste, rythme face aux plafonds, trente jours, part par modèle, fin du mois au
  rythme des sept derniers jours (rien avant trois jours de dépense dans le mois), garde-fous repliés.
- Cinquième pas : **l'onglet Accès de la page Mémoire** (`/memoire/acces`). Part des faits validés par niveau, journal d'accès filtrable par niveau
  servi (métadonnées signées seulement), carte horaire des lectures sur 30 jours à l'heure de Québec, oublis
  (compte et dates) et garde-fous, chacun pointant vers le code qui le tient. Lectures : `lib/memoire/depotAcces.ts`
  (rien de déchiffré) ; calculs purs : `lib/memoire/acces.ts`. Verrous : `tests/memoireAcces*.test.ts`.
- Sixième pas : **l'onglet Historique** (`/memoire/historique`) : faits écrits par jour sur 26 semaines (grille,
  lundi en haut), lectures et dépense des 14 derniers jours, conversations par source. Des comptes seulement, au
  jour de Québec (`lib/memoire/depotHistorique.ts`) ; humeur, relances et corrections de la maquette ne sont pas
  dessinées tant qu'elles ne sont pas mesurées. Verrou : `tests/memoireHistorique.test.ts`.
- Septième pas : **l'onglet Apprentissage** (`/memoire/apprentissage`) : courbe du banc mesure après mesure (papiers
  attendus retrouvés, « je n'ai rien » justes), score par capacité de la dernière mesure, faits tirés des conversations
  par statut (`extracteur` `conversation-*`), questions par statut, et les étapes de la passe. Des nombres seulement
  (`lib/memoire/depotApprentissage.ts`) ; une mesure illisible est écartée et comptée, jamais lue comme 0. La courbe
  d'entraînement, les versions et les habitudes de la maquette n'existent pas : aucun réseau n'est entraîné. Verrou :
  `tests/memoireApprentissage.test.ts`.
- Huitième pas : **la coque de la Mémoire, comme la maquette** (Marc, 23/10 : « exactement comme les maquettes »).
  `components/CoqueMemoire.tsx` : vue plein écran SANS le menu de l'app, retour vers LIA, logo, et les CINQ onglets
  segmentés à icônes de la maquette. `components/Tuile.tsx` : la tuile repliable (`<details>`) à filet violet, sur un
  tableau de 12 colonnes, et `Vide`, l'état vide honnête. Règle : une tuile de la maquette sans donnée est dessinée
  quand même, à sa place, avec ce qui la remplira ; jamais retirée, jamais remplie d'un chiffre inventé. L'onglet
  **Réseau** (`/memoire/reseau`) est donc là, ses quatre tuiles vides : aucun réseau n'existe encore. Écart restant,
  écran par écran, dans le dossier partagé du projet : `memoryai/design/ECART-MAQUETTE-MEMORYAI.md`. Verrou :
  `tests/coqueMemoire.test.ts`.

**LIA répond au hub (MemoryAI#91, ADR 0016)**, avant la suite du lot 5 : Marc veut LIA publiée dans toutes les apps
(22/10 21:22Z). `POST /api/ask` (`app/api/ask/route.ts`, logique pure dans `lib/lia/ask.ts`) : `x-hub-token` seul,
propriétaire seul (`proprietaire: true` dit par le hub, sinon 403), niveaux 0 et 1, outils en lecture seule
(`OUTILS_LIA_HUB`, tenus aux deux bouts par `outilsPermis` dans `tourDeChat`), lecteur `lia-hub`, question jamais
journalisée, conversation non consignée en v1. Verrous : `tests/liaAsk.test.ts`, `tests/chat.test.ts` (« outilsPermis »).
Depuis MemoryAI#74 (étape blocs), la réponse est `{ text, blocks? }` : catalogue FERMÉ de 22 formes dans
`lib/lia/blocs.ts` (copie lisible : `commun/assistant/BLOCS-lia.md`), offert par l'outil `lia_blocs` à la route ask
seule ; un bloc ne cite que des faits servis pendant le tour, sinon il est rejeté (ADR 0016 § 6).
LIA vit aussi CHEZ ELLE (ADR 0016 § 7) : `components/LiaMaison.tsx` monte `@mokarade/lia-ui#v0.33.0` sur toutes les
pages connectées (pas `/login`, pas `/widget`), ses blocs dessinés par `rendreBlocs` ; elle demande à
`POST /api/lia/ask` (session, `source` et `proprietaire` imposés, lecteur `lia-maison`). Les deux portes partagent
`lib/lia/repondre.ts`. Re-pinner le tag pour chaque nouvelle version de lia-ui (suivi au scroll, vie de la maquette).
Depuis le 23/10 (v0.13.0) : une seule LIA, identique au hub ; sa pastille d'humeur est dessinée par le paquet, l'accueil
n'en a plus d'autre.
L'état de LIA (`etat_lia` : humeur, silhouette, regard ; `lib/lia/etat.ts`), 3e argument de `ask` à partir de lia-ui
v0.15.0, entre par les deux portes : humeur et silhouette dans les listes fermées du paquet (`HUMEURS_DETAILLEES`,
`SILHOUETTES_LIA`), regard `[a-z0-9-]{1,40}` ou null, sinon 400 ; balisé `<etat_lia>` comme une
DONNÉE sur LIA avant la question, pour qu'elle ne nie plus son humeur. Le navigateur n'envoie qu'un état conforme ;
sinon la question part sans lui. Verrou : `tests/liaEtat.test.ts`.
Un champ inconnu du contexte (lia-ui plus récent) est retiré, jamais refusé.
Son état PARTAGÉ (envies, journal, humeur ; contrat `commun/assistant/CONTRAT-etat-lia.md`) vit dans `lia_etat`
(migration 0025, une ligne, des nombres et des verbes seulement ; bornes = `validerEtat` du paquet, jamais recopiées ;
`lib/lia/etatPartage.ts`, `lib/lia/depotEtat.ts`).
Deux portes : `GET|PUT /api/lia/etat` pour la maison (session, `etatHttp` du paquet, branché sur les deux montages) et
`GET|PUT /api/etat-lia` pour le hub, qui relaie ses pages et celles des apps (`x-hub-token` + `x-lia-proprietaire: 1`).
PUT : 200 + l'état gardé, 409 + l'état gardé si la version ne dépasse pas la sienne (écriture atomique), 400 / 413 ;
gelée : 503. Verrou : `tests/liaEtatPartage.test.ts`. Reste : le relais du hub.
Le hub peut joindre un `contexte` (bilan daté, ≤ 1 500 caractères, ADR 0016 § 8, oui de Marc du 23/10) : balisé
`<contexte_hub>` comme DONNÉE avant la question, refusé en 400 s'il contient un `<` ou dépasse la limite, ignoré par
la porte de la maison, jamais journalisé.
⚠️ Au 22/10 22:09Z, la clé `ANTHROPIC_API_KEY` de production est refusée (401 `invalid x-api-key`) : la route rend
503 « indisponible » tant que Marc ne l'a pas remplacée dans Vercel.

## ✅ FAIT — 22/10/2026 : Lia est l'écran principal, redessiné (MemoryAI#10, [R2])

`app/chat/ChatClient.tsx` et `app/globals.css` : la réponse de Lia est du texte sur le fond, grand et léger en sombre
(`--poids-lia`), sans bulle ; seul Marc a sa bulle. Les liens de fiche (`→`) et de papier (« papier ») deviennent des
pastilles, zone de toucher portée à 44 px. En bas, trois suggestions (« Quand finit mon bail ? »…) puis la saisie
arrondie avec un bouton d'envoi rond. La réponse arrive en fondu (éteint par `prefers-reduced-motion`).
- **Une suggestion préremplit le champ, elle n'envoie pas** : un appel payant ne part jamais d'un simple clic. Elles
  disparaissent quand on écrit ou qu'une réponse est en cours.
- **« N à juger » passe dans l'en-tête** (`Nav` accepte une prop `droite`) ; l'ancien `<details>` sous l'en-tête est retiré.
  Toujours absente quand il n'y a rien à juger.
- **Modèle, niveaux 2 et 3, coût et historique** sont repliés derrière « Options et historique (N) ». L'historique
  n'est plus une colonne fixe sur PC : un seul écran, une colonne. Ouvrir une conversation ou en commencer une referme le panneau.
- Verrou : `tests/ecranLia.test.ts`. Les verrous des citations (`liensPapiers`, `liensCites`) sont inchangés et verts.
- Reste hors de ce lot : le fil n'est pas encore en flux (réponse entière), les entrées du menu n'ont pas leur phrase d'état.

## ✅ FAIT — 22/10/2026 : icône d'écran d'accueil iPhone en logo série A (MemoryAI#60, mission .github#467)

`app/apple-icon.png` (180 x 180, strates sur tuile `#0B0D12`, même dessin que `app/icon.svg`) est publié par Next.js en `apple-touch-icon` ; avant, iOS faisait une capture de la page. iOS ne rafraîchit pas une icône déjà posée : retirer l'app de l'écran d'accueil puis la rajouter. La marque du menu (« Lia ») est du texte, rien à changer.

## ✅ FAIT — 22/10/2026 : le socle visuel « Nuit » est posé, la barre d'onglets est remplacée par un menu (MemoryAI#9, [R1])

Direction B « Nuit » (choix de Marc, 22/10) : en thème sombre, fond bleu-nuit `#10141c`, accent doré clair `#e6ce94`,
titres légers (`--poids-titre: 300`) ; tous les tokens restent dans `app/globals.css`. La barre d'onglets disparaît :
`components/Nav.tsx` rend un en-tête (bouton menu + « Lia ») et `components/MenuLia.tsx` un `<dialog>` natif
(plein écran sur téléphone, tiroir de 22 rem sur PC ; Échap ferme, le focus revient au bouton). Sept entrées
(`SECTIONS`), la première reste `/` : le `start_url` du manifeste continue d'en être dérivé. Verrou : `tests/menuLia.test.ts`.
- **Thème clair inchangé** (jetons clairs d'avant) : le passer en sombre seul est une décision de Marc.
- **Pas de police téléchargée** (convention du dépôt, CSP `font-src 'self'`) : Albert Sans de la maquette n'est pas livrée ;
  la servir depuis le dépôt (fontsource) demanderait une exception écrite.
- Les entrées du menu n'ont pas encore leur phrase d'état : R2 et R3.

## ✅ FAIT — 16/10/2026 : les erreurs du serveur peuvent partir à Sentry, sans texte d'erreur (MemoryAI#127)

`instrumentation.ts` branche `@sentry/nextjs` côté SERVEUR, réglé par `lib/sentryConfig.ts`. **Éteint tant que
`SENTRY_DSN` est absent** : le build et la CI n'ont besoin de rien. Plus strict que le modèle d'app-template : en
plus de la requête et de l'utilisateur, le TEXTE des exceptions (une erreur Drizzle recopie la requête et ses
paramètres), les fils d'Ariane, `extra` et l'entrée de journal sont retirés ; il reste le type, la pile et l'adresse
de la page. Verrou : `tests/sentryConfig.test.ts`.
- **Pas côté navigateur** : la CSP (`connect-src 'self'`) l'interdit déjà ; l'ouvrir est une décision de sécurité de Marc.
- **Pas encore actif en production** : le secret GitHub `SENTRY_DSN` existe (posé le 16/10, .github#24), mais aucune
  variable `SENTRY_DSN` n'est posée dans Vercel (décision de Marc le 16/10 : « on laisse »). Tant qu'elle manque, les
  erreurs de production ne partent pas.
- **Essai** : workflow manuel « Essai Sentry » (`npm run sentry:essai`), envoie une erreur volontaire avec le secret du
  dépôt et échoue si Sentry ne répond pas 2xx. Le dépôt est privé : il tourne sur le robot du PC.
- Le DSN part dans l'événement sous forme de clé publique seulement ; le script ne l'affiche jamais.

## ✅ FAIT — 16/10/2026 : la mémoire pose les questions qui comblent ses trous, sans modèle (MemoryAI#102, [L28])

À chaque réveil de la passe d'apprentissage (`lib/apprentissage.ts`), `lib/questions/combler.ts`
regarde les prédicats du vocabulaire qui ne portent AUCUN fait validé et pose une question en texte
libre pour chacun, **santé, puis famille, puis goûts, puis le reste**, sans appel de modèle.
- **Plafond de cinq partagé** : on ne pose que dans les places LIBRES, après les contradictions. Une
  question répondue ou écartée libère sa place, remplacée au réveil suivant. Rien n'est jamais écarté
  pour faire de la place.
- **Une question écartée ne revient pas** (index unique `(predicat_vise, question)`) : le prédicat
  suivant prend la place.
- **Jamais demandé** : niveau 3, valeurs-documents, identifiants de sujet (`relation.proche`,
  `relation.lien`, `famille.enfant`), adresse. Les prédicats à dates seulement demandent `AAAA-MM-JJ`.
- Les questions arrivent dans la pile `/questions` par la table `questions`, comme les autres.
- **Publié à part** : `comblement { trous, places, posees }` dans le résultat du cron.
- **Conséquence à connaître** : le producteur PAR MODÈLE (`produireDesQuestions`) ne tourne plus que
  si des places restent après les trous, donc presque jamais tant qu'il y a des trous. Il n'est pas
  retiré : c'est une décision de Marc, pas de cette tâche.
- **Reste** : le QCM (une option de QCM pointe vers un fait qui existe, combler veut en créer un) et
  la mesure à 30 jours (≤ 10 prédicats à zéro, 31 le 15/10).
- **Constaté, non touché** : `passeApprentissage` sort dès le début quand le budget d'IA est épuisé
  (`passeVide("budget")`), donc les contradictions et les trous attendent le lendemain ce jour-là,
  contrairement à ce que dit le commentaire sur les contradictions.

## ✅ FAIT — 16/10/2026 : le contrat hub est re-pinné sur v1.5.0, zod 4 (MemoryAI#165)

`@mokarade/hub-contract` passe de v1.4.0 à v1.5.0 (le contrat est en zod 4). Le lockfile ne porte plus
qu'un seul zod, en 4.x : la copie zod 3 sous le contrat a disparu. Aucun changement de forme du
summary. Sur le commit fusionné : déploiement de production READY et summary qui répond 401 sans jeton.

## ✅ FAIT — 16/10/2026 : Lia a une voix et un profil, en trois couches (MemoryAI#101, [L27])

Le prompt de Lia = RÈGLES (écrites par le dépôt, en tête, gardées par `tests/prompt.test.ts`) puis
`<voix>` puis `<profil>`, les deux dernières balisées comme DONNÉES (`lib/chat/prompt.ts`).
- **Voix** : texte libre de Marc, 600 caractères, `nettoyerTexte`, réglé dans `/regler` (« Comment
  Lia te parle »), table `voix_lia` (migration `0022`, une seule ligne). Vide = ton par défaut.
  Lue à CHAQUE tour : le changement se voit au message suivant.
- **Profil** : fonction pure (`lib/chat/profil.ts`) depuis les faits `valide`, N0/N1, hors
  quarantaine, liste blanche de prédicats, 1 500 caractères max. Les `propose` n'y entrent jamais.
- **Journal** : le profil sort vers un modèle, donc chaque tour qui en sert un écrit une entrée
  (`outil: "profil"`). Si le journal échoue, le profil est OMIS de ce tour et l'échec consigné.
- **Reste (hors #101)** : la voix APPRISE par l'extracteur (`preference.communication` → voix) et
  le sélecteur Sonnet/Opus. Le nom « Lia » partout : déjà en place côté UI.
- Verrous prouvés par mutation : filtre N2, quarantaine, statut, borne, échappement des balises,
  ordre règles-d'abord, journal, câblage de la route (`tests/coucheLia.test.ts`).

## ✅ FAIT — 16/10/2026 : le socle visuel commun d'app-template est appliqué (MemoryAI#126)

Les écrans suivent le socle d'app-template#39 : jetons hexadécimaux clair/sombre (`--fond`,
`--texte`, `--accent`, `--repere`, `--succes-*`…), vocabulaire commun (`.carte` `.bouton` `.champ`
`.pastille` `.bandeau`), cibles de 44 px, champs à 16 px, plus aucune ombre. Changements visibles :
l'accent passe de l'indigo au gris ardoise (réservé à l'action principale), l'onglet actif prend le
repère orangé, les boutons ont les coins du socle (plus de pilules). Les champs bruts du
navigateur (recherche des papiers, plafonds de dépenses) et les boutons sans classe de
`/a-valider` sont maintenant stylés. Verrou : `tests/theme.test.ts` (port du test d'app-template,
plus l'ordre des règles et `.champ` sur chaque saisie). `tests/contraste.test.ts` passe à l'hex.
Avant/après (écrans réels rendus sur des données fictives, mobile) : `docs/captures/socle-visuel/`.
Deux écarts au socle, nommés : `.carte` ne porte pas de largeur maximale (`.carte-page` la porte,
pour la connexion) ; `.pastille` est déclarée avant les états, sinon `.pastille.alerte` reste grise
(le socle a l'ordre inverse). Non traité, déjà là avant : les résumés de `/regler` perdent leurs
espaces (`display: flex` sur `<summary>`).

## ✅ FAIT — 16/10/2026 : seule `main` se déploie, plus aucune préversion (MemoryAI#125)

`vercel.json` : `git.deploymentEnabled` coupe tout (`**`, `*`) et rouvre la seule `main`, comme
app-template (#41) et Hubperso (#160). Avant, seules les `claude/*` étaient coupées : chaque PR passée par
la file de fusion (branches `mergify/merge-queue/*`) créait une préversion READY (constaté le 16/10 :
« Merge of #152 » et « Merge of #154 »), soit deux déploiements par PR sur le quota partagé. Verrou :
`tests/vercelJson.test.ts` (discrimine : sans `main: true` la production serait coupée). `ignoreCommand`
et le cron d'apprentissage sont inchangés.

## ✅ FAIT — 15/10/2026 : plus aucune donnée personnelle dans les fichiers de `main` (MemoryAI#128)

Employeurs, banque, école, préfecture, nom complet, dates de bail et de passeport, identifiants
de fichiers Drive et chemin Windows : remplacés par des noms FICTIFS (Banque Aurore, Alphatech,
Zenith, Jean Exemple…) dans les tests, les docs et les commentaires. Les effectifs (56, 75,
2 723…) sont gardés : ce sont des mesures, plus rattachables à personne.

⚠️ **Un changement de comportement** : l'ordre de lecture des papiers (ADR 0007 §4) ne vient
plus d'une liste écrite dans le code mais de la variable `MEMORYAI_EMETTEURS_PRIORITAIRES`
(noms séparés par `|`, dans l'ordre voulu). Tant qu'elle n'est pas posée dans Vercel, seul
« Revenu Québec » passe devant — la lecture continue, dans un autre ordre. Geste de Marc :
poser la variable (un redéploiement la prend en compte).

⚠️ **Ce que ce nettoyage ne couvre PAS** : l'historique git et le texte des anciennes PR
(#31, #32, #44, #49 citent des émetteurs). Un dépôt public sans historique passe par un
dépôt neuf (décision du 15/10).

## 🟦 REPRENDRE ICI — 25/09/2026 : la refonte de l'interface (rien n'est codé)

Marc, 25/09 : « lis tout tout tout, ensuite refonte de l'interface en entier ». Le brief complet
— cadrage tranché, interface mesurée, maquettes, architecture proposée, plan — est dans
**[`docs/REFONTE-INTERFACE.md`](docs/REFONTE-INTERFACE.md)**. À lire en premier.

- **Cadrage (Marc, 25/09)** : MemoryAI seule · tout gêne (on s'y perd, trop de texte, pas beau,
  mal fait sur téléphone) · **Lia au centre** · **maquettes d'abord**.
- **Maquettes** : <https://claude.ai/artifact/BUpBxx4n5n2YwUtiWuYZDe> — direction A « Carnet »
  en brouillon, B « Nuit » et C « Bento » dessinées le 22/10/2026 (MemoryAI#7), côte à côte sur la
  même toile ; **Marc a choisi B « Nuit » le 22/10/2026 (MemoryAI#8)**, puis plan court, puis OK.
- ✅ **`[L3-acces]` corrigé le 15/10/2026 (MemoryAI#90)** : le bandeau de l'accueil compte la pile
  (papiers lus, déductions, questions non jugés), plus seulement les questions ouvertes.
- **La lecture de tous les papiers tourne** (DriveAI C49-32, #421, 25/09) : plus de limite de
  nombre ; arrêt dur à 100 $ (projection ~55 $ pour ~2 500 papiers), frein mensuel à 40 $, donc
  la fin passe sur octobre. La tranche de 200 : 4,09 $, 173 lus, 17 illisibles, 3 sans texte,
  7 en échec.

## 🟦 EN COURS — 24/09/2026 (soir) : lot 3, la pile « vrai / faux » (ADR 0012)

L'onglet Questions devient une pile d'une carte à la fois : ce que la mémoire a LU dans un
papier, ce qu'elle a DÉDUIT, ce qui lui MANQUE. Vrai / Faux / Passer, et glisser sur téléphone.
Un « faux » laisse le papier en place, marqué contesté pour le chat (arbitrage de Marc :
« contesté, relu »). La RELECTURE et les DOUBLONS sont le lot 3b (voir BACKLOG).

⚠️ **À vérifier après le déploiement** : ouvrir Questions sur le téléphone, juger quelques cartes ;
contester un papier puis demander au chat ce qu'il en sait — il doit dire que la lecture est
contestée.

## 🟦 FAIT — 24/09/2026 : lot 2 du chantier « la Mémoire sait tout de moi » (ADR 0011) — REPRENDRE ICI

Marc, 24/09 : « que ce soit seulement moi qui puisse voir, mais ouvert par défaut ». Livré :

- **Le connecteur MCP ne lit plus le contenu des papiers d'identité** (N3). Mesuré avant : il
  servait les numéros du passeport à tout client OAuth dès qu'un modèle demandait `inclure_n3`.
  Verrou : `LECTEURS_N3 = {"chat"}` (`lib/lecture.ts`), consulté par `politique()` ; `tools/list`
  ne propose plus `inclure_n3` au MCP ; les FACETTES ne rendent plus au MCP les titulaires, types
  et émetteurs des papiers N3 (seconde fuite, trouvée en chemin).
- **Dans le chat, la case N3 est cochée par défaut** (décochable par conversation).
  `MEMORYAI_N3_CHAT` reste l'interrupteur hors produit.
- **Les papiers d'identité se retrouvent** : filtre par titulaire (clé keyée), plein texte N3
  fait EN MÉMOIRE pour le chat seulement (`lib/pieces/rechercheEnMemoire.ts`), et le prompt du
  chat nomme enfin les outils de papiers.
- **L'historique à gauche** : les conversations du chat, titrées par le premier message, se
  rouvrent (`historiqueChatAction`, `ouvrirConversationAction`). « Nouvelle conversation »
  remet l'identifiant à zéro (avant : la suite s'écrivait dans l'ancienne), et l'identifiant
  survit au rechargement de l'onglet. L'écran ne dit plus « rien n'est conservé » (faux depuis
  l'ADR 0002).

- **Correctif du 24/09 au soir** (vu par Marc au premier test) : une citation de papier ne
  devient plus « (non sourcé) » (`piecesServies`), et un refus de l'API (crédit épuisé…) s'affiche
  en clair au lieu de « Unexpected end of JSON input ». ⚠️ Le crédit de l'API se recharge dans la
  console API, organisation `c48c6d9c…` — celui de claude.ai ne compte pas (vécu le même soir).

⚠️ **Ce que Marc perd** : dans claude.ai (le connecteur), ses papiers d'identité ne sont plus
qu'en sommaire. Ils se lisent dans le chat de la Mémoire.

⚠️ **À vérifier après le déploiement** : demander au chat « quel est le numéro de mon passeport ? »
— il doit trouver le papier sans qu'on coche quoi que ce soit ; et côté claude.ai, la même
question doit rendre un sommaire.

## 🟦 EN COURS — 23/09/2026 : [L42] l'onglet Avancement (ADR 0009) (livré, en attente de mesure)

Marc, 23/09 : une interface « Avancement » dans la Mémoire, comme celle de DriveAI. Livré ici :
`POST /api/avancement` (DriveAI y pousse des COMPTES, jeton d'écriture, `.strict()`, une ligne
par app dans `avancement_sources`), et un cinquième onglet **après Parler** (`start_url` ne bouge
pas) : l'entonnoir classés → envoyés → connus → lus, chaque étage avec sa source ; la vitesse en
jours actifs et le reste selon DriveAI ; le détail par dossier ; ce qu'on tire des papiers lus
(dates, montants, numéros — des COMPTEURS, jamais une valeur). Le suivi de lecture a quitté
Dépenses. ⚠️ Pas d'étage « faits nés de la lecture » : lire écrit des papiers, pas des faits
(leçon n° 43) — les faits validés s'affichent à côté, avec la phrase qui le dit.

⚠️ **Tant que DriveAI ne pousse pas, ses deux étages disent « non mesuré »** : le producteur
(côté DriveAI) arrive dans un lot séparé, APRÈS le déploiement de celui-ci — un envoi vers une
route qui n'existe pas encore rendrait 404 et suspendrait le canal.

⚠️ La barre de navigation passe à la ligne sous 40rem : mesuré dans Chromium, elle faisait
674 px à 390 px de large (le défaut existait dès quatre onglets, ~530 px).

## 18/09/2026, 20 h 50 UTC : L35 + L36, la file de lecture (récit)

**En une phrase** : le code des deux lots est écrit, testé, revu et poussé — **rien n'est
mergé**. Marc a arrêté la session parce que **Vercel est bloqué** de son côté en ce moment
(pas un état du dépôt, pas une panne de CI). Reprendre = vérifier que Vercel répond, puis
suivre l'ordre de reprise ci-dessous — ⚠️ **qui commence par un correctif, pas par un merge.**

### Ce qui existe, où

| Quoi | Où | État CI (mesuré 20 h 50 UTC) |
|---|---|---|
| **L35** — la file de lecture (`GET/POST /api/pieces/file`, table `lectures_tentees`, ADR 0007) | MemoryAI, [PR #48](https://github.com/MoKarade/MemoryAI/pull/48), branche `claude/l35-file-de-lecture` | Audit dépendances ✅, SonarCloud ✅, **Gate (typecheck·lint·tests·build) EN ATTENTE** — pas encore vu vert ni rouge, à relire en premier |
| **L36** — la lecture du stock par la file (`src/LectureFile.gs`) | DriveAI, [PR #382](https://github.com/MoKarade/DriveAI/pull/382) **brouillon**, branche `claude/l36-lecture-par-la-file` | Les 4 checks (App web, Captures E2E, Tests unitaires, Scaffolding) **✅ tous verts** |

Les deux branches sont poussées, rien n'est en attente de commit localement (`git status`
propre dans les deux dépôts au moment d'écrire ceci).

### Ce que les deux revues ont trouvé

Un panel a relu les deux lots (`code-reviewer` sur MemoryAI, `silent-failure-hunter` sur
DriveAI — les DEUX ont notifié leur résultat avant la fin de la session).

**Corrigé, dans les deux branches :**

- **Le contrat implicite entre la file et l'écriture.** La file sert le `fileId` de
  l'exemplaire PRINCIPAL d'une pièce d'inventaire ; le remplacement (ADR 0006) se décide sur
  l'empreinte de la pièce ENTRANTE (sujet + premier exemplaire). S'ils divergent — autre
  sujet, fichiers dans un autre ordre — la pièce est acceptée comme NEUVE, l'inventaire reste
  actif, et le papier reboucle pour toujours en repayant OCR + appel de modèle, sans qu'aucun
  signal ne le dise (`acceptees: 1` a l'air d'un succès). Corrigé : `remplacees` (déjà publié
  par `POST /api/pieces` depuis L39) traverse maintenant tout le canal DriveAI, et
  `verdictDeLecture_` juge sur `remplacees`, jamais sur `acceptees`. Prouvé par perturbation.
  Documenté dans `docs/adr/0007-la-file-de-lecture.md` §5.1.
- Trouvés en écrivant (pas par la revue), aussi corrigés : une extraction vide PENDANT une
  panne de plateforme LLM était notée comme un verdict du document au lieu d'une panne de
  canal ; un `CASE` SQL qui serait devenu invalide si les listes d'émetteurs prioritaires
  étaient un jour vidées.

⚠️⚠️ **[DriveAI, HAUT, NON CORRIGÉ — À FAIRE AVANT DE SORTIR LA PR DU BROUILLON]** Le
`silent-failure-hunter` a trouvé un TROU dans le correctif « panne LLM » ci-dessus : il ne
couvre que le document qui FRANCHIT le seuil de panne systémique
(`CONFIG.LLM_ECHECS_SYST_MAX = 3`). Pour le 1er ou le 2e document d'un vrai incident réseau
(`_echecsSystemiques < 3`), `signalerPannePlateforme_` rend `false` (« hoquet isolé ») et
`estPannePlateforme_()` reste faux — donc `motif === 'extraction-vide' && estPannePlateforme_()`
est faux, le document est traité comme un vrai verdict, posté à la Mémoire, et **retiré
DÉFINITIVEMENT de la file alors qu'il n'a jamais été lu**. Contrairement au coupe-circuit
« 3 lectures Drive impossibles » (`src/LectureFile.gs`, ~ligne 362-376), qui RETRACTE les
verdicts déjà posés une fois la série confirmée, il n'existe AUCUNE rétractation symétrique
pour cette série-là. Portée bornée à 2 documents par déclenchement de panne (pas de fuite
illimitée), mais c'est un chemin RÉEL et ATTEIGNABLE, non couvert par les tests actuels
(`test/lecture-file.test.js` ne teste que le cas « déjà au seuil »). Fichiers en cause :
`src/LectureFile.gs`, `src/Piece.gs` (`extrairePiece_`), `src/Llm.gs`
(`signalerPannePlateforme_`, `_echecsSystemiques`), `src/Config.gs`
(`LLM_ECHECS_SYST_MAX`). Piste : appliquer le MÊME mécanisme de rétractation que le
coupe-circuit Drive — garder les verdicts « extraction-vide suspecte » dans un tableau à
part et les retirer si un 3e survient et confirme la panne systémique.

Deux constats MOYEN/BAS supplémentaires du même rapport, non bloquants mais à lire avant de
merger : `noterVerdictsLecture_` n'appelle jamais `suspendreMemoire_` sur échec (borné par le
frein $, donc accepté tel quel) ; `restantsRattrapage_() === null` bloque la gate de L36 tant
qu'une NOUVELLE tranche C49-5 n'a jamais mesuré son reste (inactif aujourd'hui, la tranche
actuelle étant terminée). Détail complet dans la transcription de session, pas recopié ici.

### L'ordre de reprise

1. **Corriger le HAUT ci-dessus** dans `src/LectureFile.gs`/`src/Piece.gs`/`src/Llm.gs`
   (DriveAI, branche `claude/l36-lecture-par-la-file`), avec un test qui le prouve par
   perturbation — le même patron que le coupe-circuit Drive déjà en place.
2. **Vérifier que Vercel répond** (`vercel.com` ou l'app côté Marc) — c'est le blocage qui a
   arrêté la session, rien d'autre ne l'explique.
3. **Merger MemoryAI en premier** (PR #48) : DriveAI en dépend (`404` sinon, non bloquant mais
   inutile de le mettre en ligne avant).
   - Attendre/relire le check `Gate` (encore en attente au moment d'écrire ceci).
   - Après le squash-merge : vérifier le DÉPLOIEMENT Vercel réel (§6 du CLAUDE.md — CI verte
     ≠ en ligne). SHA du merge, statut `READY`.
4. **Sortir DriveAI du brouillon** (PR #382), puis merger. `LECTURE_FILE_TAG: 'l36-a'` est
   **déjà armé dans le code** : le merge de DriveAI démarre la campagne de lecture au
   prochain tick (auto-déployé par `deploy.yml`, `clasp push` + web app republiée).
5. **Après le merge de DriveAI** : lire la ligne « Lecture par la file (L36) » dans la Santé
   de l'app DriveAI dans les ~10-15 min qui suivent. Premier signal à surveiller :
   `demanderFileLecture_` doit répondre `200`, pas `canal-file-absente` (ce dernier voudrait
   dire que MemoryAI n'est pas encore déployé avec la route — revoir l'étape 3).

### Rappel des deux décisions prises SANS feu vert explicite de Marc (dans les deux PR)

- **La voie du TICK plutôt que le runner de l'ADR-0061 Q1**, dans le sens prudent (frontière
  étroite, aucun texte intégral ne quitte le compte Google). Coût : ~2 mois de calendrier
  pour les ~2 645 papiers restants, à 17 min/j. Détail et les deux leviers si c'est trop long :
  `docs/adr/0061-le-contenu-des-documents-quitte-le-compte.md` §9, second amendement (DriveAI).
- **`LECTURE_FILE_TAG` livré ARMÉ** — la lecture démarre dès le merge de DriveAI, pas sur un
  second geste de Marc. Vider ce tag dans `Config.gs` éteint cette seule campagne si besoin.

### Ce qui n'est PAS bloqué, si quelqu'un veut avancer ailleurs en attendant

- `[L33d]` — donner le même producteur (`remplaceId`) à `faits.remplaceId`, sous l'ADR 0006
  déjà écrit. Indépendant des deux PR ci-dessus.
- `[L37]` — l'ADR qui verrouille la recherche simple (Postgres FTS + facettes, pas
  d'embeddings). Pure doc, aucune dépendance.
- Relu en chemin côté DriveAI, non corrigé : `C28-138` (la gate du rattrapage C49-5 ne se
  referme jamais — voir `BACKLOG.md` DriveAI).

---

## État au 17/09/2026, 19 h 30 UTC

**Phase 0 : livrée, en ligne, et EN SERVICE.** Les six lots sont mergés, le seed est envoyé,
claude.ai est branché, la carte du hub s'affiche. **Phase 1 : livrée** (lots 7 à 16).
**Phase 2 : le socle est livré, il n'est pas encore MESURÉ** — et la raison a changé le
17/09, voir le lot 17 plus bas.

⚠️ **Les trois chiffres ci-dessous ont été RE-MESURÉS le 17/09 à 19 h**, par le MCP et par
`Config.gs` de DriveAI, parce que trois affirmations de cette table étaient devenues fausses
en 28 h. Ce qui les a rendues fausses n'est pas le temps, c'est le lot suivant.

| Mesure | Valeur, à sa date |
|---|---|
| Faits en mémoire | **2 828 validés, 7 rejetés, 5 périmés, 0 en attente, 0 canari** (17/09, 19 h UTC). ⚠️ Ce compte INCLUAIT jusqu'au lot 19 les ~2 646 faits migrés en papiers ; il les exclut désormais et les publie à part (`migresEnPiece`). *(Était : 2 827 / 7 / 0 le 16/09 à 15 h 25 ; 98 / 7 / 0 le 15/09 à 21 h 20.)* |
| Par niveau | N0 35 · N1 1 695 · N2 1 027 · N3 83 (17/09, 19 h UTC) |
| Papiers | **2 723** dans `pieces` (17/09) — dont ~2 646 venus de la migration de l'inventaire et **77 extraits par `haiku-4.5-piece-v1`** : 23 en `04 · Immigration`, 54 en `01 · Administratif & identité` |
| Cible de l'inventaire | ⚠️ **~4 240, pas 19 900.** Mesuré par DriveAI (C49-4) le 17/09 : « 20 346 » était `Object.keys(_indexCache).length`, donc un compte de CLÉS d'Index toutes natures. Les 2 729 `document.existe` ne sont donc pas 14 % du but mais **~64 %**. ⚠️ Et 4 240 est un PLANCHER : tout document entré par **Gmail** — l'intake principal du moteur — est invisible à ce canal (`fileIdDeCleIndex_` n'accepte que quatre préfixes, la clé d'une pièce jointe n'en porte aucun) |
| Signal de fraîcheur | ⚠️⚠️ **Ce n'est plus `document.existe`, c'est le compte des PAPIERS** (`memoryai_papiers_facettes`, ou la métrique « Papiers » du hub). Voir l'encadré « deux signaux morts » plus bas : `aValider` est mort au lot 19, `document.existe` au lot 17, et le second l'a été DEUX HEURES après avoir été désigné |
| Connecteur claude.ai | ✅ `POST /api/mcp/token` en `200` le 15/09 à 21:08 ; les cinq outils répondent |
| DoD de la phase 0 | ✅ vérifiée par le MCP : « où est mon avis de cotisation 2024 » rend le fait avec son lien Drive ; « quand finit mon bail » distingue le logement du véhicule |
| Carte du hub | ✅ réparée le 15/09 à 21:31 (déploiement `98f1d64`, `READY`) — elle a servi un `500` pendant ~12 min, voir les pièges |
| Relire un papier déjà lu | ⚠️⚠️ **A rendu `HTTP 500` du 18/09 au 21/09**, et c'est ce qui a mis la campagne de lecture de DriveAI à l'arrêt : `depotPieces.remplacer` employait `db.transaction`, que `drizzle-orm/neon-http` **ne supporte pas** (mesuré dans le pilote). Vert sur 821 tests, parce que les tests tournent sur PGlite, qui les supporte. Corrigé le 21/09 — écriture en séquence, `tests/pilotePostgres.test.ts` refuse tout `.transaction(` dans `lib/` et `app/`. ⚠️ Le diagnostic n'est devenu LISIBLE que grâce au lot d'observabilité de DriveAI de la veille (« canal coupé : HTTP 500 (pièces) ») — le motif était persisté depuis toujours et lu par personne |
| `CRON_SECRET` | ✅ **posée** — prouvé par la première passe réelle du cron, le 17/09 à 09:00 UTC (six faits proposés, voir `BACKLOG.md`). ⚠️ Absente, la route rendrait **503** et le cron ne ferait RIEN : c'est un état, pas une panne, et il se lit dans la réponse |
| `MEMORYAI_N2_CHAT` | ✅ posée par Marc le 15/09 au soir — confirmé par le MCP (`niveau2Servable: true`), pas supposé |
| **Combien la mémoire sait, en tout** | ⚠️ **RE-MESURÉ le 21/09 à 20 h UTC** : **100 faits validés** (dernier le 19/09, 0 en attente, 7 rejetés, 6 périmés) et **2 748 papiers** — soit **2 848 informations**. C'est le chiffre que publie désormais la carte du hub, en métrique PRINCIPALE, et qu'affiche `/regler` en tête. *(Les 2 828 « validés » de la ligne du 17/09 incluaient l'inventaire, migré en papiers depuis : rien n'a été perdu, le compte a changé de colonne.)* |
| **Papiers réellement LUS** | ~**106** sur 2 748 au 21/09 : les 2 642 autres sont des coquilles de l'inventaire — la mémoire sait que le document existe et où il est, pas ce qu'il contient. C'est la campagne de lecture de DriveAI qui les remplit, et c'est ELLE qui fait monter « Papiers », jamais « Faits validés » |

### ⚠️⚠️ Deux signaux de fraîcheur morts de la même façon (17/09)

C'est la leçon la plus réutilisable de ce dépôt à ce jour, et elle s'est payée deux fois :

1. Le lot 19 a mesuré que **`aValider` n'est plus un signal** — le canal DriveAI entre
   directement en `valide` (ADR 0003), donc la file reste à 0 même à plein régime. Il a
   désigné en remplacement « le `nombre` du prédicat `document.existe` ».
2. **Deux heures plus tard**, le lot 17 a migré ces mêmes faits en papiers sans les retirer
   des compteurs. `estServable` les excluait bien de ce qui est SERVI ; la garde manquait là
   où on COMPTE. Le compteur est resté **figé à 2 729** pendant 28 h, et la doc a continué de
   dire de le surveiller.

**Rien ne pouvait rougir** : un compteur agrégé rend toujours un nombre. La parade, posée au
lot 19 bis (`tests/comptesMigres.test.ts`) : les compteurs excluent les migrés, le compte des
migrés est PUBLIÉ, et trois mutations rougissent — une par filtre, plus le « en construction »
qui exigeait le vide des deux côtés.

⚠️ **La question à se poser avant de désigner un compteur comme signal** : qu'est-ce qui, dans
un lot futur, changerait ce qu'il agrège ? Si la réponse existe, le signal a besoin d'un test
qui le dit.

**Phase 2 : l'ADR 0004 est ACCEPTÉ** (Marc, 16/09, après une séance de cadrage en QCM et la
lecture des quatre décisions irréversibles). Il amène trois amendements à l'ADR 0001 — le CONTENU des documents
entre et est servi (numéros d'identité compris, ceux de Marc **et de ses proches**), MemoryAI
détient désormais **un** jeton (lecture chez FinanceAI), et le vocabulaire des faits GRANDIT
sous quarantaine au lieu d'être fermé. Le seul lot engagé est le **socle** : table `pieces`,
**100 documents seulement**, recherche par facettes, PWA installable — et il MEURT si moins de
**8 des 10 questions de test** trouvent leur réponse. Rien ne part dans un autre dépôt avant
ça, sauf l'ADR que DriveAI doit écrire pour envoyer le contenu (prérequis du socle).

### Les lots 25 et 26a (18/09) — Lia cite, et la barre passe de huit onglets à trois

**[L25a] Le défaut que Marc a signalé le 17/09 était une REQUÊTE, pas une mémoire vide.**
`memoryai_contexte` servait **2 faits sur 99** : `faits()` ne filtrait que `supprimeLe`,
ordonnait par `creeLe` décroissant et coupait à 500 — les ~2 729 papiers migrés saturaient la
fenêtre. Le correctif est une condition PARTAGÉE (`conditionServis` dans `lib/depotLecture.ts`),
consommée par `faits()` ET par `comptes()` : deux lectures du même « ce qui est servable »
divergeaient, et aucune n'était fausse toute seule.

**[L25c] Lia CITE ses faits, et le lien du PAPIER était manquant** (« j'ai pas les liens pour
les documents », Marc, 18/09). `lib/chat/liens.ts` annote la réponse APRÈS coup : une
étiquette servie devient un lien vers sa fiche, un papier porte en plus son lien Drive, une
référence INVENTÉE est marquée « (non sourcé) » et un fait `propose` « (à confirmer) ».
⚠️ La leçon du lot : **apparier sur ce que le modèle ÉCRIT, jamais sur ce que la base
STOCKE** — mes trente premières gardes appelaient le module avec une entrée fabriquée à la
main, donc ZÉRO rougissait à la perturbation ; c'est le test qui TRAVERSE (du dépôt jusqu'au
texte annoté) qui a trouvé le défaut.

**[L26a] Huit onglets → trois.** Parler (l'accueil EST la conversation), Chercher, Régler.
`/chat` redirige vers la racine ; les compteurs quittent la tête de page pour Régler → État.

| | État |
|---|---|
| Barre de navigation | ✅ trois entrées, **toutes réelles**. Garde : chaque `href` mène à un `page.tsx` qui EXISTE, et aucune page ne disparaît de la barre en silence (`tests/navSections.test.ts`) |
| Onglet **Voir** | ⏸️ **repoussé à L30, mesuré** : aucune requête d'échéances n'existe dans ce dépôt (zéro fonction ; seule la clé d'attribut `echeance` existe). Un onglet qui ne mène nulle part coûte un clic pour apprendre qu'il n'y a rien |
| Le graphe | ⏸️ **PAS retiré**, contrairement à ce que L26 annonçait : son remplaçant est la frise de L30, et il est aujourd'hui le seul endroit où l'on VOIT ce que les cinq règles produisent. `L26c` porte le retrait, après L30 |
| Contenu des cinq pages | ⏸️ `L26b`. L26a REGROUPE la navigation ; les **16 actions serveur** des cinq pages se déplacent une par une, chacune avec sa garde |
| Bandeau « Ce qui s'en vient » | ⏸️ L30 (même cause que l'onglet Voir) |

⚠️⚠️ **Le défaut de ce lot n'a été trouvé ni par `typecheck`, ni par `lint`, ni par mes
quatre gardes neuves — mais par `npm run build`, au bout de trois minutes** : `/chat/page.tsx`
appelait `requireSession()` sans déclarer `force-dynamic`, donc Next a tenté de la PRÉRENDRE
et l'export a levé `NonAutorisé`. J'avais recopié l'appel du voisin **sans sa précondition**.
Mesuré après coup : **13 des 14 pages** la déclaraient, `/login` comprise, qui n'appelle même
pas `requireSession()`. La règle est donc universelle dans cette app, et elle est désormais
une garde d'une seconde (`tests/gardePages.test.ts`) plutôt qu'un build de trois minutes.
Ce qui la rend plus qu'un confort : **une page prérendue est une page servie depuis un CACHE
à tout le monde** — pour une app dont chaque page lit la mémoire d'une personne, c'est la
pire des issues, et elle serait SILENCIEUSE si le rendu statique réussissait.

### Le lot 33a (18/09) — la fiche d'un fait, et ce qu'on peut en faire

Demande de Marc, le 18/09 : « full retravailler comment ça affiche les faits et ce qu'on en
fait ». Cadrée en QCM le même jour — et sa réponse en TEXTE LIBRE (« voir le document lié, ou
tous les documents liés ») portait un rattachement qu'aucune de mes options n'anticipait.

**Les cinq constats qui ont cadré le lot, tous mesurés avant d'écrire une ligne :**

| Constat | Mesure |
|---|---|
| La fiche que Marc atteint depuis le chat ÉTAIT la carte de la file de validation | `CarteFait` n'avait que **2 consommateurs** : `/a-valider` et `/fait/[id]` |
| Sur un fait VALIDÉ, les seuls gestes étaient « Rejeter » et « Oublier » | `Valider` se cache quand le statut l'est déjà : donc **deux boutons destructeurs, et rien d'autre** |
| Rien ne permettait de CORRIGER | `depotFaits` n'a aucun mutateur d'édition, alors que `remplaceId` existe au schéma — correction *représentable*, *inatteignable* |
| La fiche n'affichait pas les faits LIÉS | `depotLiens` les calcule ; on ne les voyait que dans le dessin du graphe, que L26c veut retirer |
| L'en-tête était du vocabulaire MACHINE | `identite · personne.nom.legal`, puis 3 à 5 badges, puis un `<dl>` brut des attributs |

**Ce qui est livré (L33a)** : la valeur et la phrase en tête, le reste sous « D'où ça vient » ;
un papier porte son TYPE au lieu de son fileId ; le document source, les autres faits du même
document, les faits liés avec leur `pourquoi`, et « demander à Lia là-dessus ».
**Ce qui ne l'est pas** : `L33b` **corriger un fait** — ça touche le contrat d'écriture, donc
**ADR avant le code** (§11) ; `L33c` les papiers en LISTE (`/pieces` a son propre habillage).

⚠️ **Rejeter / Oublier restent VISIBLES** : je les avais proposés en repli, Marc ne l'a pas
coché. Une option non retenue est une décision, pas un oubli à rattraper.

⚠️⚠️ **Le libellé humain existait déjà, en position subordonnée.** Le vocabulaire porte
`d("logement.bail.fin", …, "Fin du bail")` et `rendreLisible` le posait dans `description`,
affiché en `hint` SOUS la valeur pendant que le nom machine occupait l'en-tête. « Full
retravailler l'affichage » s'est donc réduit à une **INVERSION** de ce qui est dominant — et
écrire la table de phrases qu'on croyait devoir écrire aurait été pire qu'inutile : elle
aurait divergé en silence de la description, qui est la source unique.

⚠️⚠️ **Et « les documents liés » était à un CHAMP de distance, pas à une requête neuve** :
`provenances.source_ref` est `notNull` **et indexé** (`provenances_source`, index posé
exactement pour cette lecture), et `rendreLisible` le JETAIT. Une colonne écrite, un index
posé, aucune surface entre les deux — et rien ne pouvait rougir.

**Gardes** : 26 cas (12 purs dans `tests/faitPhrase.test.ts`, 11 qui TRAVERSENT depuis la base
dans `tests/ficheRattachements.test.ts`, 2 de tokens CSS dans `tests/couleurs.test.ts`),
**11 perturbations → une rouge chacune**. ⚠️ Deux perturbations étaient d'abord MUETTES, et les
deux diagnostics différaient : l'une était une perturbation no-op écrite par moi, l'autre a
démasqué une garde **VACUEUSE** écrite d'après un COMMENTAIRE qui sur-promettait. Les deux ont
été corrigés — le commentaire ET la garde.

⚠️ **Le schéma a réfuté mon cas de test deux fois**, et chaque refus a appris : `liens.fait_a`
porte une FK vers `faits` et `fait_b` non (donc un identifiant de question ne peut être qu'en
B — mon scénario était impossible), puis `check("liens_question_seulement_cause")` n'autorise
un tel lien qu'avec le type `cause-declaree`. La décision qui en dépendait a quitté le JSX
pour un module pur (`autreExtremite`).

### Le lot 33b (18/09) — corriger un fait, et l'ADR qui n'était pas nécessaire

Le geste que Marc a choisi en premier le 18/09. Livré : un champ sur la fiche, sous un dépli
« Corriger ce fait ». Écrire la bonne valeur, la valider ; l'ancienne est **gardée**, marquée
`perime` — « remplacée par un plus récent », jamais `rejete`, parce qu'elle était vraie à sa
date.

⚠️⚠️ **J'annonçais un ADR (§11, contrat d'écriture) et la mesure l'a rendu inutile.** Rien
n'est déplacé : `ecrireLot(…, MARC, …)` est le chemin par lequel Marc écrit depuis le lot
des questions, et `admin.valider` périme déjà tout seul les autres faits validés du même
prédicat non `multi`. La question qui tranche n'est pas « ça ressemble-t-il à une
frontière ? » mais « quel champ, quel mutateur, quelle table n'existe pas encore ? ».

⚠️ **Ce qui EXIGE bien un ADR, trouvé par la même passe** : `remplaceId` est LU (la règle de
graphe `remplacement`, la ligne « remplace … » de la fiche) et **écrit par personne** en
production — zéro producteur, seulement des fixtures. La règle de liaison ne peut donc pas
tirer, depuis plusieurs lots. Ticket `[L33d]`.

| | État |
|---|---|
| Le geste | ✅ `lib/corrigerFait.ts` (logique, testable) + une Server Action MINCE. Une union DISCRIMINÉE porte la cause : un refus muet ferait repartir Marc en croyant sa mémoire à jour |
| Prédicats `multi` | ✅ `depotAdmin.perimer` — le SEUL mutateur ajouté. Sans lui, `valider` ne périme rien sur un `multi` et la « correction » AJOUTE au lieu de remplacer. Invisible sur un prédicat simple, c'est-à-dire sur la plupart |
| Papiers (`ref_document`) | ⏸️ REFUSÉ explicitement : la valeur est un fileId Drive, la retaper casserait le seul lien fiable du papier. Ce qui se corrigerait, c'est ce que l'extracteur a compris — hors lot |
| Fiabilité | ✅ **marc**, pas celle du document corrigé. Une correction tapée n'a pas la fiabilité d'un document officiel, même quand elle en corrige un |
| `remplaceId` (pièces) | ✅ `[L39]` — producteur livré le 18/09 |
| `remplaceId` (faits) | ⏸️ `[L33d]` — ADR 0006 écrit, code à faire |

**Gardes** : 9 cas sur PGlite et le vrai chemin d'écriture, **7 perturbations → une rouge
chacune**. ⚠️ La 7ᵉ était d'abord MUETTE, et le diagnostic est réutilisable : `fiabilites`
est un **plafond** (liste blanche), pas une valeur — élargir le plafond ne change rien tant
que l'entrée ne déclare pas `fiabilite_source`. La perturbation juste touche la VALEUR **et**
la PERMISSION.

### Le lot 26b (18/09) — Régler absorbe l'État, et la purge reste dehors

L26a avait regroupé la NAVIGATION ; ce lot commence à fusionner le CONTENU. Les compteurs,
les dépenses (par poste et depuis le début), la répartition par domaine et le vocabulaire
s'affichent maintenant EN PLACE dans **Régler → État**. `/moi` ne porte plus que la purge.

| | État |
|---|---|
| État (`/moi` → Régler) | ✅ presque gratuit : `/regler` FETCHAIT déjà **3 des 5** lectures de `/moi` pour n'en afficher qu'un compteur (manquaient la dépense totale et le vocabulaire). ⚠️ J'avais écrit « 4 des 5 » sans mesurer ; la revue l'a recompté |
| La purge | ⏸️ **reste sur `/moi`, délibérément**. Le ticket demande « purge plus difficile » : un dépli du hub la rendrait plus FACILE. Lien qui dit ce qu'elle fait, pas « ouvrir » |
| Conversations | ⏸️ **NON, et c'est une mesure** : un `<details>` masque à l'œil mais EXPÉDIE son contenu. Inliner mettrait les résumés dans la source du hub à chaque chargement |
| À valider | ⏸️ reste une page : plan de travail (7 des 12 actions), pas un panneau |
| Liens | ⏸️ `L26c` le retire après `L30` |
| Apps | ⏸️ `L26b2`, le dernier candidat qui en vaille la peine |

⚠️⚠️ **La fusion a cassé quelque chose que rien n'aurait dit.** Dix Server Actions
invalidaient `/moi` parce que les compteurs y vivaient ; les déplacer n'a pas déplacé les dix
listes — mesuré : **10 sites sur `/moi`, zéro sur `/regler`**. Invisible côté serveur (les
pages sont `force-dynamic`), visible en navigation CLIENT, où Next sert le payload RSC en
cache : Marc valide un fait, revient sur Régler par la barre, et lit un compteur d'avant son
geste. Corrigé par une **source unique** (`app/rafraichirCompteurs.ts`), pas par dix
corrections.

⚠️ **Le périmètre écrit par L26a était faux, et c'est moi qui l'avais écrit** : « 16 actions
serveur » comptait celles de `/questions`, `/chat` et `/pieces`. Recensé : **12**.

⚠️ **Trois doublons que la séparation cachait** : `/moi` affichait « À valider », « Niveau 2 »
et « claude.ai », que Régler portait déjà dans ses propres sections. Ils ne sont pas recopiés,
et la garde vérifie les DEUX sens — rien de perdu, rien affiché deux fois. Le second sens est
celui qu'on oublie : « rien n'est perdu » est satisfait par une COPIE, et une copie divergera.

**Gardes** : `tests/reglerFusion.test.ts`, **6 perturbations → une rouge chacune**.

⚠️⚠️ **LE PANEL A BATTU LE GATE, deux fois, après la PR ouverte.**

1. **L'app INSTALLÉE ouvrait la page de purge.** `app/manifest.ts` portait
   `start_url: "/moi"` — juste quand `/moi` était l'accueil fonctionnel, dangereux depuis que
   ce lot en fait la seule page de purge. Et `tests/partage.test.ts` ÉPINGLAIT `"/moi"` : la
   garde **certifiait** la valeur périmée. `start_url` est maintenant **dérivé** de
   `SECTIONS[0].href` — un manifeste, personne ne le relit.
2. **Deux de mes six ancres de garde étaient trop LARGES**, chacune prouvée par mutation :
   `"comptes()"` était satisfait par la lecture des PAPIERS quand celle des FAITS
   disparaissait, et `"purgerAction"` par un COMMENTAIRE quand le formulaire perdait son
   action. Le correctif n'est pas de réparer deux ancres mais d'exiger leur **UNICITÉ** :
   une ancre qui désigne deux sites ne peut pas dire lequel a disparu.

Et un trou antérieur trouvé au passage : **six** pages lisent un compteur agrégé, la source
unique en connaissait **deux** — dont l'accueil, qu'aucune action n'invalidait.

⚠️ **Non vérifié à l'œil, et je le dis plutôt que de le laisser croire** : toute page privée
appelle `requireSession()`, donc un serveur de développement lancé d'ici atterrit sur
`/login`. Le contrôle visuel de Régler → État est un geste de Marc.

### Le lot 34 (18/09) — Dépenses & import, et les plafonds passent aux mains de Marc

Nouvelle direction, demandée le 18/09 : « je veux que ce soit lia qui lise tous mes fichiers
et qui commence à grandir », « une base de donnée avec toutes les infos », et « la recherche
simple, limite sur telephone — la puissance des autres modeles sera surtout pour comprendre ce
que je veux et mettre du contexte ».

⚠️⚠️ **Mesuré avant de cadrer : DEUX de ses trois points étaient déjà bâtis.**

| Son point | État mesuré |
|---|---|
| « une base avec toutes les infos » | ✅ **existe** — `pieces` porte les facettes KEYÉES (filtrables sans déchiffrer), les dates, le résumé, `champsStructures` et `champsLibres`, dont le commentaire dit « c'est ici, et seulement ici, que *je veux tout* vit sans vocabulaire ». Le graphe s'en nourrit déjà |
| « recherche simple, limite sur téléphone » | ✅ **existe** — `to_tsvector('french', …)` + facettes keyées. Du Postgres, **aucun modèle pour trouver**. Sa contrainte EST l'architecture ; il reste à l'ÉCRIRE (`L37`) avant que quelqu'un ajoute des embeddings |
| « Lia lit tous mes fichiers » | ⏸️ **83 lus sur 2 728** (mesuré en direct). Les 2 645 autres sont des noms de fichiers jamais ouverts. Et la LECTURE vit dans **DriveAI** — ce dépôt reçoit (`POST /api/pieces`), il n'extrait pas |

**Livré (L34)** : un **quatrième onglet**, demandé explicitement (« jveux pouvoir choisir dans
lapp je veux aussi un onglet dédié aux depenses a limport »). Il porte la dépense du jour par
poste, le total, le **coût moyen par appel** (la seule grandeur qui serve à estimer la suite),
les **plafonds réglables**, et **où en est la lecture** (lus / non lus par extracteur).

⚠️⚠️ **Pourquoi régler un plafond ne contredit PAS l'ADR 0001 §5.5** (« plafond dur, non
désactivable », Q15) : ce qui y est interdit est de l'**ÉTEINDRE**. Et le test qui verrouillait
la somme des postes disait LUI-MÊME que relever un poste oblige « à rouvrir le total avec
Marc, ce qui est une décision de dépense » — le garde-fou nommait le geste que Marc vient de
faire. Restent tenus, chacun gardé : un plafond **existe** toujours (absence = défaut du
16/09), il est toujours **consulté** (`budgetOuvert` le prend en argument REQUIS — `tsc` a
énuméré les cinq sites), il est **borné** par le code ET par la base (`plafonds_borne`).

⚠️ **Un plafond dynamique rend faux les textes qui le citaient** : deux classes d'erreur
interpolaient la constante (« sur 1 $ » à quelqu'un qui en a mis cinq). Le plafond est devenu
un argument de leur message.

⚠️ **Trois gardes écrites par d'autres lots ont rougi, et les trois avaient raison** : le
journal des migrations (0015 absent), « les quinze tables » (il y en a seize — le compte est
dans le titre), et **ma propre garde de L26b**, une heure après avoir été écrite : elle a
attrapé `/depenses` comme surface à compteur non invalidée. C'est exactement ce qu'elle
existait pour faire, et elle n'a pu le faire que parce qu'elle DÉRIVE la liste du code.

**Gardes** : `tests/plafondsEtImport.test.ts` (12 cas sur PGlite) + les bornes dans
`tests/coutChat.test.ts`, **8 perturbations → une rouge chacune**. Gate : 774 tests.

**Suite** : `L35` la file de lecture (par valeur d'émetteur, export Facebook en dernier —
choix de Marc), `L36` la boucle dans **DriveAI**, `L37` l'ADR qui verrouille la recherche
simple.

### Le lot 35 (18/09) — la file de lecture : la Mémoire sait ce qui reste à lire

`GET /api/pieces/file?extracteur=…&limite=…` rend les prochains `fileId` à lire, dans l'ordre
de Marc (émetteurs nommés d'abord, export Facebook en dernier), et `restants`. `POST` note les
VERDICTS des documents qui ne donnent rien (liste fermée ; une panne de canal est refusée).
ADR 0007. **Aucun état n'est tenu pour le cas nominal** : un papier lu quitte la file parce
que sa lecture a remplacé son inventaire ([L39]). La seule table neuve, `lectures_tentees`,
porte les papiers essayés sans résultat — clé `(file_id, extracteur)`, donc un lecteur neuf
ré-ouvre tout. L'onglet Dépenses dit combien, et pourquoi la jauge n'ira pas à 100 %.
⚠️ Jeton d'ÉCRIVAIN exigé (403 sinon), et le gel de Marc arrête la lecture (503).
⚠️ Le consommateur est dans **DriveAI** (`[L36]`) ; la VOIE (tick ou runner) reste à l'ADR-0061.

### ✅ RÉGLÉ PAR LE LOT 39 (18/09) — l'import n'est plus inerte

Ce qui suit décrit le défaut TEL QU'IL ÉTAIT, parce que c'est ce qui explique la forme du
correctif. **État actuel : une vraie lecture REMPLACE un inventaire** (ADR 0006 §2, un seul
sens autorisé), l'ancienne ligne est gardée en `statut: "remplacee"`, la neuve la désigne par
`remplaceId`, et `POST /api/pieces` publie `remplacees` — sans quoi DriveAI ne pourrait
toujours pas distinguer un enrichissement d'un ajout.

**Le défaut, tel qu'il était : une pièce déjà en base n'était JAMAIS réécrite — donc lire un
document que l'inventaire connaît était un NO-OP.** Vérifié dans le code : `empreintePiece(cle, sujet, fileId)` identifie
le **document**, pas la lecture ; et `lib/pieces/ecrire.ts` fait `dejaPresentes += 1;
continue;` sur collision, sans aucun `UPDATE` — son en-tête le dit : « une pièce déjà écrite
est `dejaPresentes`, **jamais dupliquée ni réécrite** ».

Conséquence : les **~2 645 papiers de l'inventaire ne peuvent pas devenir « lus »**. DriveAI
peut ouvrir le document, appeler un modèle, **payer l'appel** et poster la pièce : même
`sujet`, même `fileId` ⇒ même empreinte ⇒ ligne intacte. L'argent part, rien ne change.

⚠️ Il BLOQUAIT `L36` (la boucle de lecture dans DriveAI) : **le blocage est levé.** Et il
explique probablement le **83 lus sur 2 728** — ces 83 seraient les documents SANS ligne
d'inventaire antérieure. Reste à mesurer sur la prod :
`SELECT extracteur, count(*), min(cree_le), max(cree_le) FROM pieces GROUP BY extracteur`.

⚠️ L'idempotence n'était pas le défaut : refuser un double POST est juste. Ce qui manquait
était la distinction entre « la même pièce repostée » (refusée) et « la même pièce ENRICHIE
par une vraie lecture » (acceptée). Marc a tranché les trois questions le 18/09 : seule une
vraie lecture remplace un inventaire, l'ancienne est gardée et marquée, un seul ADR couvre
les pièces et les faits.

⚠⚠ **Et une ALARME de ce ticket était FAUSSE** : « 97 % de la mémoire n'est pas cherchable,
une colonne `recherche` nulle ne matche rien ». `validerPiece` la DÉRIVE du type et de
l'émetteur, que la migration pose — mesuré en base : un inventaire porte bien
`recherche = "bail gestion exemple 2026"`. Ces papiers sont trouvables par leur **étiquette**,
jamais par leur **contenu**. Le défaut était vérifié dans le code ; l'alarme était un
raisonnement sur un champ absent, sans demander qui d'autre le remplit.

### Le lot 38 (18/09) — des graphes, et le chiffre qui dit si l'import TOURNE

Marc : « je veux des graphs voir ce qui reste ce qui a été traité depuis combien de temps etc
combien de liens fais etc ». Livré sur l'onglet Dépenses : jauge de progression, deux
histogrammes (documents lus par jour, dépense par jour, 30 jours), compte des liens par type,
et les grandeurs dérivées — rythme, estimation, « depuis combien de temps ».

⚠️⚠️ **La grandeur la plus utile n'était pas celle demandée** : un import arrêté depuis trois
semaines et un import qui avance ont la MÊME barre de progression. Celle qui les distingue est
« rien n'a été lu depuis N jours ».

⚠️⚠️ **Deux rythmes, et l'un mentirait.** 83 documents lus en UNE journée il y a trois
semaines : « total ÷ jours écoulés » = 4/jour → « il reste 670 jours » (progression
imaginaire) ; « total ÷ jours ACTIFS » = 83/jour → « environ 32 jours où l'import tourne ».
L'unité de l'estimation est en jours ACTIFS, et le libellé le dit.

| | État |
|---|---|
| Calcul | ✅ `lib/importEtat.ts`, module PUR — `aujourdhui` en argument, donc testable et sans bombe à retardement |
| Graphes | ✅ SVG au serveur, zéro JavaScript, aucune couleur en dur, résumé parlé composé par l'appelant |
| Refus d'inventer | ✅ rythme nul ⇒ AUCUNE estimation (jamais `Infinity`) ; total nul ⇒ « rien à mesurer » (jamais `0 %`) ; part inconnue ⇒ pas de jauge |
| Contraste | ✅ garde neuve (`tests/contraste.test.ts`) — rien ne calculait de ratio dans ce dépôt avant |

**Paires mesurées par la garde** (seuil asserté, pas la valeur) : la barre de l'histogramme
(`--accent`) et le remplissage de la jauge (`--succes-texte`) sur `--surface-douce` (non-texte,
seuil 3) ; `--texte-doux` sur `--surface-douce` et `--surface` (texte, seuil 4,5). Jetons renommés
par MemoryAI#126 (ex-`--surface-2`, `--ok`, `--text-soft`) ; les ratios se lisent en lançant
`tests/contraste.test.ts`, pas dans ce fichier.

⚠️ **Le panel a trouvé trois choses après un gate vert**, dont la plus grave n'est pas dans le
diff (voir l'encadré ci-dessus). Les deux autres : une clé React dérivée de l'ÉTIQUETTE
(`MM-JJ`, année tronquée) alors que la fenêtre montre les 30 jours ACTIFS — donc deux barres
à un an d'écart pouvaient partager une clé ; et mes étiquettes d'axe à **4,2 px rendus** sur
téléphone, dont le correctif (largeur fixe + défilement) a lui-même introduit une région
inatteignable au clavier.

**Gardes** : `tests/importEtat.test.ts` (14 cas purs) + `tests/contraste.test.ts` (7),
**9 perturbations → une rouge chacune**. Gate : 795 tests.

### Le lot 17 (le socle) — commencé le 16/09 au soir

Poussé sur `claude/keen-noether-b0jwkm`, gate complet vert — **595 tests, compté le 16/09**
(typecheck, lint, vitest, build) :

| | État |
|---|---|
| **[S7]** les 10 questions figées | ✅ `lib/questionsTest.ts` — validées telles quelles par Marc. Un test les compare MOT POUR MOT à l'ADR : elles ne peuvent plus être adoucies. ⚠️ Le seuil est **strict** : 8 sur 10 **ET** la n° 5 |
| **[S1]** la table `pieces` | ✅ tables, régime de chiffrement (`0009`) **et la migration des `document.existe` en pièces** (`0012`). Du code, pas du SQL : la valeur est chiffrée sous l'AAD `id|niveau`. **Par lots de 50, sur un clic de Marc dans `/a-valider`**, les plus anciens d'abord ; rien n'est effacé et le bouton d'à côté remet tout comme avant |
| **[S2]** le contrat d'écriture | ✅ `lib/pieces/validerPiece.ts` |
| **[S4]** la recherche | ✅ facettes keyées, plein texte français, dépôt de lecture et **deux outils MCP** (`memoryai_papiers_facettes`, `memoryai_papiers_chercher`). Un N3 revient en SOMMAIRE — domaine et dates seulement ; ce qui ne sort pas est COMPTÉ, jamais tu |
| **[S6]** PWA + partage Android | ✅ installable, `share_target` en POST (le texte personnel ne passe jamais par l'URL), aucun FICHIER accepté — un document entre par DriveAI, jamais ici. Icônes : des aplats, à remplacer quand Marc voudra |
| **[S5]** la quarantaine du vocabulaire | ✅ un prédicat neuf entre au lieu d'être refusé, et il n'atteint aucun modèle avant d'être sorti — par Marc d'un clic sur `/a-valider`, ou par trois extracteurs DISTINCTS. Huit mutations, chacune ne rougissant que sa cible |

⚠️⚠️ **[S3] N'EST PLUS BLOQUÉ — le canal transporte depuis le 17/09.** Ce paragraphe disait
« BLOQUÉ, et c'est structurel » jusqu'à ce que la mesure le réfute : Marc a franchi la porte
C49-3 (l'audit), DriveAI porte `RATTRAPAGE_PIECE_TAG: 'c49-5-a'` (`src/Config.gs`), et **77
pièces `haiku-4.5-piece-v1`** sont en base — 23 en `04 · Immigration`, 54 en `01 ·
Administratif & identité`. Le contenu des documents SORT du compte Google et ARRIVE ici.

⚠️⚠️ **MAIS LE SOCLE RESTE INÉVALUABLE, et pour une raison qui n'a rien à voir.** Ces 77
pièces reviennent toutes en `forme="sommaire"`, niveau 3 : domaine et dates, **aucun type,
aucun émetteur, aucun contenu** — c'est l'ADR 0001 §5.3, appliqué correctement, pas un défaut.
Or `04` et `01` sont précisément les deux domaines que cette règle couvre. Le 17/09 Marc les a
choisis **en premier**, contre la recommandation, « pour voir tout de suite ce que la Mémoire
sait de mes papiers d'identité » : ce sont les deux seuls dont elle ne peut, par conception,
presque rien montrer. Conséquence, mesurée par le MCP :

| Question du socle | Répondable par ces 77 pièces ? |
|---|---|
| n° 5 (le téléphone sur le contrat du propriétaire) — **celle sans laquelle le socle n'a rien prouvé** | ❌ domaine `03`, dont les 3 pièces viennent de `moteur-inventaire-v1` : aucun contenu extrait |
| n° 2, n° 3 (numéro de police, dates de bail) | ❌ contenu non servi en N3 |
| n° 1, n° 4, n° 8 (localiser par type / émetteur / année) | ❌ ni type ni émetteur en sommaire |
| n° 10 (statut d'immigration + échéance) | ✅ probable — les échéances SONT servies (`date_echeance`) |

**Ce qu'il faut pour mesurer le socle** : que le rattrapage passe sur un domaine à contenu
servi — `02 · Finances`, `03 · Logement & véhicule`, `05 · Carrière`. C'est un geste de Marc
côté DriveAI (`PREFIXES_DOMAINE_DECISIF_PIECE`), pas un lot ici.

⚠️ **CÔTÉ DRIVEAI, AU 17/09** : C49-1, C49-1 bis, C49-2 bis, C49-4 étape A et C49-5 étape B
sont livrés. **Le flux VIVANT reste éteint** (`CONFIG.PIECE_PUSH = false`) — `traiterDocument_`
a huit appelants, dont les campagnes de masse, donc l'allumer re-tarife aussi ce qui tourne
déjà. Ce qui a poussé les 77 pièces est le **RATTRAPAGE armé**, pas le flux.

⚠️ **Ce qui attend un geste de Marc pour la phase 2**, dans l'ordre — ⚠️ les deux premiers
points de la version précédente sont FAITS et ont été retirés (PR #364 fusionnée, audit C49-3
franchi) :
1. **choisir un domaine à contenu servi pour le prochain rattrapage** (`02`, `03` ou `05`) :
   sans lui, les questions du socle ne peuvent pas être mesurées, donc le socle ne peut être
   ni validé ni tué ;
2. ensuite seulement, allumer `CONFIG.PIECE_PUSH` pour le flux vivant.

**Phase 1 : l'ADR 0002 est ACCEPTÉ** (Marc, 15/09) et le **lot 7 est livré**. Il cadre les
cinq chantiers demandés (apprendre des conversations, chantier A, widgets, graphe 3D, page de
questions) et amende la frontière de l'ADR 0001 sur le seul point qui bouge : le texte
intégral des conversations.

| Lot 15 — l'auto-validation des faits mécaniques (ADR 0003, décision de Marc du 16/09) | État |
|---|---|
| `lib/autoValidation.ts` : la règle PURE, par PROVENANCE (`COUPLES_MECANIQUES`) | ✅ |
| Le flux écrit `valide` + `valide_le` pour un couple mécanique, `propose` pour tout le reste | ✅ |
| Rattrapage du stock déjà en base : `drizzle/0007_auto_validation_mecanique.sql` | ✅ appliqué au merge (les branches `claude/*` ne déploient aucune préversion) |
| Un canari, un REJET de Marc, un fait oublié : jamais rattrapés | ✅ prouvé par mutation (6 mutations, 6 rouges) |
| Un couple ajouté sans sa migration fait ÉCHOUER le gate | ✅ `tests/autoValidation.test.ts` |
| ⚠️ Ce qui reste de la demande de Marc : « que l'IA lise tout et me pose des questions » | ✅ lot 16 |

| Lot 16 — la mémoire apprend TOUTE SEULE (Marc, 16/09 : « je veux aussi que l'IA commence à apprendre ») | État |
|---|---|
| Budget **3 $/jour**, réparti et nommé : chat 1 $ · apprentissage 2 $ (arbitrage de Marc) | ✅ `lib/coutChat.ts`, somme verrouillée par test |
| Chaque dépense porte son POSTE en base (`drizzle/0008_…`) — le chat ne peut plus affamer l'apprentissage | ✅ |
| L'extraction se déclenche SEULE : fin d'un tour de chat (`after()`) **et** cron quotidien | ✅ |
| `POST /api/cron/apprentissage` — secret DÉDIÉ (`CRON_SECRET`), 503 s'il manque, 401 s'il est faux | ✅ |
| Une passe DIT toujours pourquoi elle s'arrête (six motifs distincts, jamais le silence) | ✅ `MOTIFS_FIN_PASSE` |
| Le producteur de questions alimente enfin `/questions` — le modèle ne voit AUCUNE valeur | ✅ `lib/questions/producteur.ts` |
| Discrimination prouvée | ✅ 9 mutations, 9 rouges (`tests/apprentissage.test.ts`) |
| `CRON_SECRET` posée dans Vercel — sans elle la route rendrait `503` et le cron ne ferait rien | ✅ **prouvée par l'usage** : première passe réelle le 17/09 à 09:00 UTC |

⚠️ **LA PREMIÈRE PASSE RÉELLE DU CRON MARCHE, ET ELLE RE-PROPOSE CE QUI EST DÉJÀ VALIDÉ**
(17/09, 09:00 UTC). Six faits `propose` par `conversation-v1`, zéro canari, zéro erreur — la
mécanique est bonne. Mais les six sont des doublons de faits déjà `valide` (bail logement,
bail véhicule, un fournisseur), **deux au caractère près**, un troisième APPAUVRI, et la
fiabilité DESCEND au passage (`document-tiers` validé → `app` proposé). Cinq des six prédicats
sont `multi: false` et portent désormais deux faits chacun. C'est le risque n° 1 du projet
(CLAUDE.md §9 n° 5) qui arrive par la porte que le lot 16 vient d'ouvrir : si la passe tourne
chaque jour en re-proposant le même stock, `/a-valider` se remplit de redites et les faits
DÉDUITS — les seuls qui méritent l'œil de Marc — y sont ensevelis. **Question à trancher AVANT
de coder** : existe-t-il une dédup sur ce chemin, et pourquoi deux valeurs identiques la
traversent-elles ? Mesuré, non corrigé, aucun feu vert (détail dans `BACKLOG.md`).

⚠️ **Ce que le producteur de questions voit, et c'est TOUT** : le vocabulaire, et pour chaque
prédicat combien de faits VALIDÉS il porte. Aucune valeur, aucun fait, aucune conversation.
« `sante.allergie` : 0 fait » ne dit rien sur Marc — ça dit ce que la mémoire ignore, ce qui est
exactement la question qu'on lui pose. La surface d'injection est nulle parce qu'aucun texte écrit
par quelqu'un d'autre n'entre dans ce prompt.

⚠️ **Le seuil réactif est de 4 messages non extraits** (`SEUIL_MESSAGES_NON_EXTRAITS`). À 1,
chaque tour de chat déclencherait un appel et le budget partirait en une soirée ; plus haut, Marc
dit quelque chose d'important et la mémoire ne le voit que le lendemain.

⚠️ **MESURÉ après le merge, à 15 h 25 UTC** : `aValider` est passé de **2 689 à 0**, `valide` de
138 à **2 827**, et `dernierFaitValideLe` porte l'instant de la migration. Le rattrapage a validé
EXACTEMENT sa règle et rien d'autre — l'arithmétique le ferme : `document.existe` porte 2 729 faits,
les 105 autres se répartissent sur 45 prédicats et étaient tous déjà traités par Marc. Rien n'est
supprimé ; la file ne garde désormais que ce qu'un MODÈLE a déduit, la seule chose sur laquelle une
question ait un sens.

⚠️ **`aValider` N'EST PLUS un signal de fraîcheur** — et c'est le piège que ce lot vient de créer.
Il restera à 0 même quand le canal DriveAI transporte à plein régime, puisque tout ce qu'il envoie
entre directement en `valide`. Quiconque continue de lire `aValider` conclura « le canal est mort »
sur un canal parfaitement vivant.

⚠️⚠️ **Et le remplaçant désigné ici est mort à son tour, DEUX HEURES plus tard.** Ce paragraphe
disait « le compte à surveiller est le `nombre` du prédicat `document.existe` : 2 729 au 16/09
15 h 25, cible ~19 900 ». Les trois éléments de cette phrase sont tombés :
- le lot 17 a migré ces faits en PAPIERS, et les compteurs ne filtraient pas les migrés : le
  nombre est resté **figé à 2 729** pendant 28 h, quoi qu'il arrive (corrigé au lot 19 bis) ;
- ce qui arrive désormais arrive dans `pieces`, donc ce prédicat ne monterait plus de toute façon ;
- « ~19 900 » était un compte de CLÉS d'Index : la cible réelle est **~4 240** (DriveAI C49-4).

**Le signal d'aujourd'hui est le compte des PAPIERS** — `memoryai_papiers_facettes`, la métrique
« Papiers » du hub, ou `/pieces`. Voir l'encadré « deux signaux morts » en tête de ce fichier :
la leçon n'est pas « ce compteur-ci était mal choisi », c'est qu'un compteur AGRÉGÉ désigné
comme signal doit porter un test qui rougit quand un lot change ce qu'il agrège.

| Lot 18 — LE RETRAIT d'une pièce (17/09) | État |
|---|---|
| `/pieces` : ce qui est arrivé du CONTENU des documents, le plus récent d'abord | ✅ |
| Un bouton « Retirer » par papier, branché sur l'oubli DÉFINITIF de l'ADR 0001 | ✅ `lib/pieces/depotOubli.ts` |
| L'empreinte se pose AVANT la suppression, et sur TOUS les exemplaires | ✅ prouvé par mutation (4 mutations, 4 rouges, chacune sur sa seule cible) |
| « introuvable » plutôt qu'un `ok` complaisant sur une pièce déjà partie | ✅ |
| L'écran ne déchiffre RIEN : domaine, niveau, date, extracteur, `fileId` — pas de contenu | ✅ liste FERMÉE, un champ ajouté fait tomber le test |

⚠️ **CE CHEMIN N'EXISTAIT PAS, et la décision de Marc s'appuyait dessus.** Le 17/09 il a choisi
de pousser `04 · Immigration` et `01 · Administratif & identité` **en premier** au rattrapage,
contre ma recommandation, pour la raison suivante : « pour voir tout de suite ce que la Mémoire
sait de mes papiers d'identité — et si c'est mauvais, on arrête avant d'avoir dépensé ». Or
« arrêter » empêche la SUITE de partir ; ça ne retire pas ce qui EST parti. `empreinteOubliPiece`
était écrite, testée et commentée depuis C49-1, la table `oublis` porte le genre `piece`, le dépôt
savait LIRE les oublis — et **personne ne pouvait en poser un** : ni page, ni outil MCP, et le
bouton « oublier » de `/a-valider` ne vise que les FAITS. C'est
`UN-CHAMP-TYPE-SANS-PRODUCTEUR` appliqué à un chemin de repli, et c'est plus grave que sa forme
ordinaire : **un repli qu'on croit avoir est un repli qu'on n'a pas.**

⚠️ **Le retrait est DÉFINITIF, et c'est voulu.** L'empreinte survit à la suppression : la pièce ne
revient ni par le rejeu, ni par le rattrapage, ni par le flux vivant. Un retrait qui se ferait
ré-écrire au tick suivant n'en serait pas un. Il n'y a pas de corbeille.

| Lot 24 — « Banque Aurore » s'écrit de trois façons, et le modèle l'apprend (17/09) | État |
|---|---|
| Les graphies d'un même émetteur sont REGROUPÉES et annoncées au modèle | ✅ `lib/pieces/familles.ts`, pur |
| Rien n'est FUSIONNÉ en base — la note dit quelles graphies repasser en filtre | ✅ |
| Fixture = la FORME du relevé des 2 723 papiers (effectifs réels, noms fictifs depuis le 15/10), pas un jeu d'essai | ✅ `tests/familles.test.ts` |
| Discrimination prouvée | ✅ 2 mutations sur 3 (la 3ᵉ a révélé du code mort, retiré) |

⚠️ **Le défaut, mesuré** : « Qu'est-ce que j'ai comme papiers de Banque Aurore ? » rend **56** au
lieu de **75** — Banque Aurore (56) + Banque Aurore Assurances (12) + Banque Aurore Assurances
Générales (7). Même chose pour Alphatech (15 + 11 + 9), Zenith (49 + 6) et Facebook
(151 + 9 + 6). C'est exactement ce que la question n° 8 du socle avait prévu **avant que le
code existe** : son `ceQueLEchecDesigne` dit « l'émetteur est écrit de trois façons ».

⚠️ **ON NE FUSIONNE RIEN, et c'est le cœur du dessin.** « Banque Aurore » et « Banque Aurore
Assurances » sont deux entités réelles (la caisse et l'assureur) : les confondre en base
perdrait une distinction que Marc n'a pas demandé de perdre, et de façon irréversible. On ne
peut pas non plus chercher par PRÉFIXE — les émetteurs sont filtrés par clé keyée (un HMAC),
et un hash n'a pas de préfixe. Ce qui reste, et qui suffit : **le DIRE au modèle**, avec les
graphies exactes à repasser. La décision reste la sienne, parce que « Facebook » et « Facebook
Marketplace » peuvent légitimement ne pas être la même chose selon la question.

⚠️ **LIMITE CONNUE et mesurée** : un nom RÉORDONNÉ n'est pas rattrapé. « Meta-Facebook » (7)
appartient à la famille Facebook pour un humain, mais son premier mot est « Meta » — le total
annoncé est 166 et non 173. Élargir à « n'importe quel mot en commun » regrouperait tout ce qui
contient « Assurances » ou « Québec » : **un faux regroupement coûte plus qu'une graphie
manquée**, parce qu'il fait perdre confiance dans toute la note. La valeur reste listée dans
les facettes de toute façon.

⚠️ **UNE MUTATION A RÉVÉLÉ DU CODE MORT, et il a été retiré.** Mon premier jet filtrait les
suffixes juridiques (`inc`, `ltee`…) en croyant rapprocher « Zenith inc. » de « Zenith » — or
on ne garde que le PREMIER mot, et « inc » est toujours le second : le filtre ne pouvait rien
changer. La mutation qui le supprimait laissait les 7 cas verts. C'était de la redondance
déguisée en garde, donc du code qu'on aurait maintenu pour rien.

⚠️ **Mon attendu était faux avant que le code le soit** : j'avais écrit 173 pour Facebook. La
mesure a dit 166, et c'est l'attendu qui a changé — pas la règle. Un test écrit d'après ce
qu'on croit trouver encode cette croyance.

| Lot 23 — ce que les captures de Marc ont montré, et le gate local enfin vert (17/09) | État |
|---|---|
| `memoryai_papiers_chercher` publie le TOTAL de ce qui correspond | ✅ `compter()`, une requête COUNT |
| Les dates de pièce sont BORNÉES à [1900, 2100], pas seulement leur forme | ✅ l'échéance en 2125 ne rentrerait plus |
| « Épingler » ne pré-remplit plus RIEN (ni prédicat, ni valeur) | ✅ `app/chat/ChatClient.tsx` |
| `.gitattributes` : les `.mjs` restent en LF | ✅ **+26 tests récupérés**, gate local vert pour la 1ʳᵉ fois |
| `docs/A_FAIRE_MOI.md` : la méthode des secrets et du hook, écrite dans le dépôt | ✅ |
| Discrimination prouvée | ✅ 2 mutations (`tests/honneteteOutils.test.ts`, 7 cas) |

⚠️⚠️ **LE GATE LOCAL EST VERT POUR LA PREMIÈRE FOIS : 664 tests, 56 fichiers sur 56.** Les deux
fichiers qui échouaient au chargement depuis toujours (`seed.test.ts`,
`sourcesConversation.test.ts`) passent — c'était le CRLF, et le `.gitattributes` le règle.
**26 tests étaient perdus** : personne ne les avait jamais vus tourner sur ce poste. Le coût
réel n'était pas les deux rouges, c'était qu'on avait appris à les ignorer — un vrai rouge
apparu à côté se serait perdu dans le bruit.

⚠️ **Un outil qui tronque sans dire le total fait INVENTER des bornes basses à son lecteur.**
Mesuré sur les captures de Marc : claude.ai a répondu « au moins 214 papiers », puis « au moins
68 Banque Aurore », quand il y en a 2 723 et 75. Le modèle n'avait pas menti — l'outil ne lui
disait rien. La troncature était à DEUX étages (la tranche servie, et `LIMITE_LECTURE_BASE` en
base), donc compter les lignes rendues n'aurait corrigé que le premier : il fallait un COUNT.
Et les conditions du filtre sont désormais écrites UNE fois et partagées entre `chercher` et
`compter` — un total qui ne décrit pas la liste affichée est pire qu'un total absent.

⚠️ **Un défaut par PRÉ-REMPLISSAGE est le plus traître : il ne demande aucune erreur, juste de
la confiance.** « Épingler » proposait le PREMIER prédicat du vocabulaire et la RÉPONSE ENTIÈRE
du modèle comme valeur. Sur la capture de Marc : une réponse sur son bail, prédicat proposé
`emploi.employeur`, valeur « Ton bail se termine le 30 juin 2028 (validé). Il a débuté le 1er
avril 2025, appartement… ». Un clic et la mémoire portait une phrase de 200 caractères sous un
prédicat sans rapport, en fiabilité `marc` — la plus haute. Plus rien n'est pré-rempli, le
bouton est désactivé tant que les deux champs manquent, et le type attendu est affiché.

⚠️ **Le schéma bornait `annee` à [1900, 2100] et les DATES, non** — elles n'avaient qu'un
contrôle de FORME. D'où une échéance au **2125-03-23** en base. Une telle date ne fait rien
planter : elle se range en dernier pour toujours, et le papier n'expire jamais aux yeux de la
mémoire — ce qui vide la question n° 6 du socle. Deux représentations de la même chose, une
seule gardée : c'est le genre d'écart qu'on ne voit qu'en lisant les deux côte à côte.
⚠️ **La pièce fautive est TOUJOURS en base** : la borne empêche la récidive, elle ne nettoie
pas le stock. Elle se retire d'un clic dans `/pieces`.

⚠️ **Les bornes sont LARGES exprès.** On ne refuse pas une date « improbable » mais une date
IMPOSSIBLE : un acte de naissance de 1920 et un bail courant jusqu'en 2090 sont légitimes, et
les refuser ferait perdre de vrais documents — bien pire qu'une échéance farfelue.

| Lot 22 — les doublons exacts, et un réveil toutes les 3 h (17/09) | État |
|---|---|
| Doublon EXACT sur prédicat MULTIPLE ⇒ question « lequel garder ? » | ✅ `doublonsExacts`, filtre exactement inverse de `contradictions` |
| Choisir REJETTE l'autre (`aRejeter`) — `valider` ne périme rien sur un prédicat multiple | ✅ |
| « Garder les deux » = le bouton « Écarter » existant, aucune troisième forme d'option | ✅ |
| Réveil **toutes les 3 h** par GitHub Actions, gratuit | ✅ `.github/workflows/apprentissage.yml` |
| Discrimination prouvée | ✅ 6 mutations (`tests/contradictions.test.ts`, 20 cas) |

⚠️ **LE « CONTINU » NE PEUT PAS PASSER PAR VERCEL, et c'est mesuré** : le compte est au plan
**hobby** (`list_teams`, 17/09), qui plafonne les crons à **un par jour** — c'est ce que
`vercel.json` déclare (`0 9 * * *`) et ça ne s'augmente pas sans payer, contre la règle « tout
gratuit ». GitHub Actions est déjà dans le parc et sa planification est gratuite : le workflow
ne fait qu'UN appel HTTP, aucun code n'y tourne, aucune donnée de Marc n'y transite, le runner
n'a jamais accès à la base.

⚠️ **Le cron de `vercel.json` RESTE** : il est le filet si les secrets GitHub sont retirés, et
une passe qui n'a rien à lire ne dépense rien. Deux réveils valent mieux qu'aucun.

⚠️ **Ce qui borne la dépense n'est PAS la fréquence** mais le budget par poste (2 $/jour
d'apprentissage, relu en base avant chaque appel). Réveiller huit fois par jour ne peut pas
dépenser plus qu'une fois — les passes suivantes sortent sur « budget » sans rien appeler. Et
la détection des contradictions, qui n'appelle aucun modèle, tourne à CHAQUE réveil : c'est
elle qui rend le « continu » utile.

⚠️ **Secrets absents ⇒ le workflow SORT EN SUCCÈS**, avec un avertissement qui dit quoi poser.
Un planificateur qui rougit chaque jour pour une intégration pas encore branchée apprend à
être ignoré, et le jour d'une vraie panne personne ne regarde. Même règle que la route
elle-même (503/401 sont des états, pas des pannes).

👤 **Deux secrets à poser dans GitHub → Settings → Secrets → Actions** (irréductible : ce sont
des secrets, aucune session ne peut les créer) : `MEMORYAI_URL` = `https://memoryai.hubperso.com`,
et `CRON_SECRET` = **la même valeur** que dans Vercel. Puis « Run workflow » à la main une fois
pour lire le verdict dans le journal.

⚠️⚠️ **UNE MUTATION MUETTE A RÉVÉLÉ QUE LE DÉTECTEUR N'ÉTAIT BRANCHÉ PAR RIEN.** Débrancher
`doublonsExacts` de `poserContradictions` laissait **19 tests sur 19 verts** : tous appelaient
le détecteur EN DIRECT. Le code était juste, testé, et n'était appelé par personne — et le
titre de mon test annonçait « retirer de la passe fait rougir ce cas », ce qui était FAUX.
Corrigé par une garde qui TRAVERSE (état en base → question posée, rejet croisé compris) et par
un titre qui dit ce que le cas fait vraiment. C'est `UN-TROU-ENTRE-DEUX-MOITIES-TESTEES` du
parc, et il a fallu jouer la mutation pour le voir.

⚠️ **Les deux détecteurs ont des filtres exactement INVERSES**, et un test garde la partition :
`contradictions` ne regarde que les prédicats à valeur unique (deux valeurs différentes = un
choix), `doublonsExacts` que les multiples (la même valeur deux fois = un doublon). Aucun
prédicat ne peut produire deux questions concurrentes, aucun n'échappe aux deux.

| Lot 21 — une divergence devient une QUESTION en QCM, et le 17/09 est rattrapé (17/09) | État |
|---|---|
| Détection des contradictions, PURE et sans modèle (`lib/questions/contradictions.ts`) | ✅ |
| `origine: "regle"` gagne enfin un producteur — déclarée à l'ADR 0002 §5.1, sans producteur depuis | ✅ `lib/questions/poserContradictions.ts` |
| `/questions` répond en un clic : une valeur par bouton, sa provenance dessous | ✅ migration `0013`, colonne `options` |
| Le rattrapage du 17/09 : les faits écrasés par une re-déduction sont restaurés | ✅ migration `0014`, atomique et idempotente |
| Discrimination prouvée | ✅ 5 mutations (`tests/contradictions.test.ts`, 14 cas) |

⚠️ **DÉCISION DE MARC, 17/09** : « tout ce que tu me dis de faire à la main, je veux que ça
soit automatique… une page de questions avec des questions précises que je peux répondre soit
en QCM soit en texte, alors oui, mais le reste non non. » Ce lot applique la règle aux deux
bouts : la réparation ne demande **aucun** clic, et le seul geste qui reste est un choix sur
`/questions`. Le QCM est l'interface CHOISIE ; la liste « Faits remplacés » du lot 20 reste,
mais comme filet de dernier recours, plus comme la voie normale.

⚠️ **Une divergence ne passe plus par `/a-valider`, et c'est le cœur du lot.** Valider un fait
y périme silencieusement le concurrent — c'est ce qui a coûté cinq faits. Une valeur qui
contredit une valeur déjà validée devient donc une QUESTION portant les **deux** valeurs avec
leur provenance lisible (« lu sur un document · moteur-document-v1 » contre « déduit par un
modèle · conversation-v1 »). Le choix ne peut plus être fait à l'aveugle parce qu'il n'y a plus
d'aveugle possible.

⚠️ **La détection tourne HORS du garde-budget**, et ce n'est pas un oubli : elle se compose à
partir de l'état de la base, sans aucun appel de modèle, donc elle ne coûte rien. La mettre
derrière le même garde que les questions de modèle ferait attendre le lendemain à une
divergence sur une date de bail, pour une raison budgétaire qui ne la concerne pas.

⚠️ **AUCUNE hiérarchie de fiabilité n'a été écrite, et c'est délibéré.** `FIABILITES` est une
liste PLATE : rien dans ce dépôt ne dit que « document » bat « modèle ». En inventer un ordre
ici en aurait fait un arbitre silencieux sur les données de Marc. C'est la question qu'il a
tranchée le 17/09 en choisissant le QCM — les libellés de `PROVENANCE_LISIBLE` servent à
RECONNAÎTRE une source, jamais à la classer.

⚠️ **Un modèle ne peut pas fabriquer d'options.** `questionSchema` reste STRICT à trois champs
(`question`, `predicat_vise`, `motif`), donc le chat, claude.ai et les extracteurs ne peuvent
pas faire pointer un choix vers le fait de leur choix. Seul `questionDeContradiction` en pose,
depuis des faits lus en base — et `optionChoisie` revérifie au clic que le `faitId` du
formulaire appartient bien aux options de CETTE question. Sans elle, un formulaire forgé
validerait n'importe quel fait, donc en périmerait un autre.

⚠️⚠️ **Le commentaire d'une migration ne peut pas CITER le marqueur de découpage de Drizzle.**
Mon premier jet écrivait le marqueur de découpage en toutes lettres pour expliquer le
piège du pilote HTTP — le découpage étant un `split()` sur cette chaîne et non un analyseur
SQL, le fichier s'est coupé au milieu de la phrase et Postgres a reçu un morceau commençant
par une apostrophe inverse orpheline. Le texte qui décrit un séparateur ne peut pas contenir
ce séparateur. (Et le premier jet de cette migration passait par une table TEMPORAIRE entre
trois instructions : elle n'aurait pas survécu d'une requête à l'autre en production, alors
que PGlite l'aurait laissée passer — exactement la panne du 16/09.)

⚠️ **C'est un test EXISTANT qui a trouvé le défaut le plus grave de ce lot** : `tests/db.test.ts`
exige que `drizzle/meta/_journal.json` décrive exactement les fichiers SQL committés. Mes deux
migrations n'y étaient pas — elles n'auraient **jamais été jouées en production**, avec une
suite verte. Le test porte la phrase qui le dit : « les deux peuvent diverger dans le pire
sens ».

| Lot 20 — un fait validé ne se re-propose plus, et ce qu'on a remplacé revient (17/09) | État |
|---|---|
| Garde `doublon_valide` à l'écriture : même prédicat, valeur IDENTIQUE, un fait `valide` existe ⇒ refus nommé | ✅ `lib/ecrireFaits.ts` |
| Bornée aux prédicats `multi: false` — les seuls où valider PÉRIME quelque chose | ✅ exigé par une mutation, voir ci-dessous |
| Section **« Faits remplacés »** dans `/a-valider`, avec « Remettre en service » | ✅ `depotAdmin.perimes` + `restaurerAction` |
| Discrimination prouvée | ✅ 3 mutations, 3 rouges (`tests/doublonValide.test.ts`, 8 cas) |

⚠️ **Le mutateur de réparation existait DÉJÀ, il manquait le fil.** `admin.valider(id)` accepte
n'importe quel fait vivant, y compris `perime`, et périme au passage celui qui l'avait remplacé :
le retour en arrière est donc EXACT et aucun mutateur neuf n'a été écrit (en ajouter un aurait
réécrit la règle du prédicat non-`multi` une seconde fois). Ce qui manquait était une LISTE :
aucune surface ne montrait les faits périmés. Même classe que `empreinteOubliPiece` au lot 18 —
un repli qu'on croit avoir est un repli qu'on n'a pas.

⚠️ **Une mutation a révélé un effet de bord sur le CANAL PRINCIPAL, et a resserré la garde.**
Mon premier jet ne regardait pas `multi` : il refusait donc aussi les `document.existe`
(`multi: true`, ~4 240 faits poussés en continu par DriveAI). Un document re-annoncé sous une
autre `source_ref` — reclassement, clé d'Index qui change — passait de `dejaPresents` à un
refus, ce qui aurait fait chercher une panne du mauvais côté du canal. Le raisonnement qui
décide n'est pas le symptôme mais le DOMMAGE : il vient de la péremption, et la péremption
n'existe que pour un prédicat non-`multi`. **Une garde se borne à ce qu'elle a mesuré.**

⚠️ **Égalité STRICTE, jamais normalisée.** Le cas du 17/09 était identique caractère pour
caractère ; rabattre casse et accents refuserait des CORRECTIONS légitimes en silence.

⚠️ **Ce qui reste à faire, et qui est un geste de Marc** : ouvrir `/a-valider` → « Faits
remplacés » et cliquer « Remettre en service » sur les **cinq** faits de `document-tiers`
(les deux baux, le kilométrage, le fournisseur). Aucune session Claude ne peut le faire : les
outils MCP n'ont aucune écriture de validation, et `estServable` refuse de servir un fait
`perime` — leurs identifiants sont donc inatteignables d'ici. Le clic périme du même coup le
doublon `app`.

| Lot 19 bis — les compteurs cessent de compter ce qui n'est plus servi (17/09) | État |
|---|---|
| `comptes()` et `comptesParDomaine()` excluent les faits `migre_en_piece` | ✅ un seul prédicat `servis`, écrit une fois, appliqué aux cinq requêtes |
| Le compte des migrés est PUBLIÉ (`migresEnPiece`), jamais silencieux | ✅ `/moi` le dit et renvoie vers `/pieces` |
| Le hub publie une métrique **« Papiers »** à côté de « Faits validés » | ✅ champ REQUIS dans `ComptesMemoire` — le compilateur a énuméré les 9 appelants |
| « En construction » exige le vide des DEUX côtés (faits ET papiers) | ✅ avec son contrôle négatif |
| Discrimination prouvée | ✅ 3 mutations, 3 rouges, chacune sur sa cible (`tests/comptesMigres.test.ts`) |

⚠️ **Pourquoi « Faits validés » chute de 2 828 à ~180 sur la carte du hub, et pourquoi c'est
JUSTE.** L'ADR 0004 §6.2 le dit en toutes lettres : « ça répare un défaut mesurable — le
compteur du hub annonce 2 827 faits dont 96,5 % sont des noms de fichiers ». Ce que ce lot
ajoute, c'est que la chute soit EXPLIQUÉE : sans la métrique « Papiers » à côté, une baisse de
94 % est indiscernable d'une perte de données. Rien n'est effacé, rien n'est même modifié en
base — seuls les compteurs cessent de mentir.

⚠️ **Trois anomalies mesurées en passant, non corrigées, sans feu vert** (détail dans
`BACKLOG.md`) :
1. une pièce porte une échéance au **2125-03-23** — un siècle, très probablement `2025` mal lu
   par Haiku ; elle empoisonnerait la question n° 6 (« qu'est-ce qui expire dans 90 jours ») ;
2. **l'émetteur est écrit de trois façons**, exactement ce que le `ceQueLEchecDesigne` de la
   question n° 8 avait prévu AVANT le code : Banque Aurore 56 + Banque Aurore Assurances 12 +
   Banque Aurore Assurances Générales 7 ; Alphatech 15 + ALPHATECH INDUSTRIES INC. 11 + Alphatech
   Industries 9 ; Zenith inc. 49 + Zenith 6. Plus un `Anthropic, PBC_2` qui a l'air d'un
   artefact. « Qu'est-ce que j'ai comme papiers de Banque Aurore ? » rend 56 au lieu de 75 ;
3. **1 568 papiers sur 2 723 (57 %) ont l'émetteur « Inconnu »** — l'inventaire migré ne
   portait que ce que le NOM du fichier disait.

| Lot 7 — la page de questions | État |
|---|---|
| `/questions` : la question, son motif, un champ, deux gestes (répondre, écarter) | ✅ |
| Outil MCP `memoryai_demander` — claude.ai et le chat peuvent poser une question | ✅ |
| Plafond de 5 ouvertes, appliqué à l'ÉCRITURE ; la plus ancienne est écartée, jamais supprimée | ✅ |
| Répondre passe par `validerFait` puis validation — pas d'écriture directe | ✅ |
| Une question déjà posée ne se repose jamais, même écartée (index unique en base) | ✅ |

| Lot 8 — les conversations | État |
|---|---|
| Tables `conversations` + `messages`, AAD `conversation\|source\|index` | ✅ |
| Scan de secrets AVANT chiffrement — 10 formes nommées, corpus positif ET négatif | ✅ |
| Le chat de MemoryAI consigne ses échanges (au mieux : un échec ne casse pas le tour) | ✅ |
| `/conversations` : combien, quand, ce que ça pèse, alerte à 60 % du plafond Neon, « Oublier » | ✅ |
| claude.ai et Claude Code | ✅ lot 10 |

| Lot 9 — l'extraction | État |
|---|---|
| « En tirer des faits » sur `/conversations` : la conversation propose, `/a-valider` reçoit | ✅ |
| Conversation balisée comme DONNÉE, délimiteurs neutralisés, sortie JSON stricte | ✅ |
| Écrivain `conversation` en fiabilité `app` — jamais `marc` : c'est un modèle qui interprète | ✅ |
| Coût compté AVANT lecture, plafond du chat vérifié AVANT l'appel | ✅ |
| `extraite_jusqua` : un RANG, donc une conversation qui continue redevient extractible | ✅ |

⚠️ **L'extraction ne part JAMAIS toute seule.** C'est un bouton. Une passe automatique
dépenserait le budget sans que Marc l'ait demandé, et remplirait « à valider » d'un coup.

⚠️ **Le scan de secrets est une HEURISTIQUE.** Il attrape les formes connues (clés Anthropic,
OpenAI, AWS, GitHub, Slack, PEM, JWT, en-tête porteur, URL avec mot de passe, variable
d'environnement) plus tout candidat opaque assez long et assez mélangé. Il ratera les autres.
Marc a choisi que Claude Code pousse automatiquement (ADR 0002 §4, question C) : personne ne
relit avant l'envoi, et ce scan est la seule chose entre un secret collé et la base.

⚠️ **Rien ne pose encore de question tout seul.** L'origine `regle` (l'ADR §5.1) n'a aucun
producteur : la file se remplit quand claude.ai ou le chat appellent `memoryai_demander`. Si
elle reste vide après quelques conversations, c'est le PROMPT qu'il faut regarder, pas la
page — le modèle doit savoir que l'outil existe et à quoi il sert.

| Lot 11 — les périmètres | État |
|---|---|
| `/apps` : ce que chaque app peut lire ou écrire, réglable par Marc | ✅ |
| Aucune valeur de jeton affichée, même tronquée — seulement les NOMS de variables | ✅ |
| Le niveau 3 ne s'accorde pas : il n'a aucun contenu stocké | ✅ |
| Chantier A côté DriveAI | ⬜ **demande son propre ADR là-bas** |

⚠️ **`perimetres` était lue et jamais écrite.** `depotFaits` la consulte avant chaque écriture
depuis le lot 3, et aucune page ne la remplissait. Le repli était sain, donc rien ne rougissait
— et le périmètre était inutilisable. C'est réparé ; le widget en dépendait entièrement.

| Lot 12 — le widget | État |
|---|---|
| `/widget?app=<id>` : lecture seule, bornée au périmètre réglé dans `/apps` | ✅ |
| Sans périmètre, il ne montre RIEN — le défaut sûr est le vide, pas « tout » | ✅ |
| CSP par ROUTE : `frame-ancestors` ouvert au hub sur `/widget` seul, `'none'` partout ailleurs | ✅ |
| Un invité de l'app hôte lit une phrase dans le cadre, jamais un rectangle blanc | ✅ |
| Aucune écriture : pas de formulaire, pas de Server Action, pas de `postMessage` | ✅ |

⚠️ **Ce qu'une app doit faire pour l'embarquer** : une `<iframe src="https://memoryai.hubperso.com/widget?app=<son id>">`,
et RIEN d'autre — pas de jeton, pas d'appel serveur. C'est le cookie de session partagé qui
identifie Marc, et le périmètre réglé dans `/apps` qui décide de ce qui s'affiche. **Une app
sans périmètre affiche un cadre qui explique qu'il n'y a pas de réglage** : c'est voulu, et
c'est le premier geste à faire dans `/apps` avant de brancher une iframe quelque part.

⚠️ **`/widget` est la seule page dont le refus ne part pas en redirection** (`ROUTES_CADREES`,
`lib/authGuard.ts`). Sa sécurité repose donc entièrement sur son `requireSession()` — le
matcher du middleware, lui, n'a pas bougé. Voir le piège plus bas.

| Lot 13 — le graphe | État |
|---|---|
| Table `liens` + les CINQ règles de l'ADR §5.3, PURES et testées une par une | ✅ |
| Chaque lien porte la PHRASE qui dit pourquoi il existe — un graphe s'audite ou s'ignore | ✅ |
| Les règles s'abstiennent au-delà de 8 faits par groupe, et le DISENT à l'écran | ✅ |
| `/graphe` montre l'ÉCART entre ce qui est enregistré et ce que les règles donnent aujourd'hui | ✅ |
| Un lien de MODÈLE ne sera jamais confondu avec un lien de règle (colonne `origine`) | ✅ (la colonne existe ; aucun modèle ne propose encore) |
| Rendu | ✅ **2D en SVG** (lot 14) — Marc a écarté la 3D le 16/09 |

| Lot 14 — le dessin | État |
|---|---|
| Un graphe 2D en SVG, rendu côté serveur, **sans une ligne de JavaScript** envoyée | ✅ |
| Disposition PURE et DÉTERMINISTE : un fait ne bouge que si la mémoire change | ✅ |
| Aucune couleur en dur — `tests/couleurs.test.ts` le refuse, deux exceptions nommées | ✅ |
| Ce que le dessin n'affiche pas est DIT (faits sans lien, au-delà de 48 nœuds) | ✅ |

⚠️ **La 3D a été ÉCARTÉE par Marc le 16/09**, contre la lettre de l'ADR 0002 §5.3. Ce qui a
emporté la décision : à ~100 faits, une 3D est MOINS lisible qu'un plan — elle sert quand la
densité dépasse ce qu'un plan peut montrer. On évite au passage 1 Mo de dépendance à auditer
chaque semaine et une CSP à rouvrir. Si la mémoire grossit au point que le cercle sature, la
question se rouvre — et rien de ce qui est livré ne serait jeté.

⚠️ **Le recalcul est un BOUTON, jamais un automatisme.** Il lit tous les faits, les déchiffre et
réécrit une table : le faire à chaque affichage ferait payer une écriture à une page qu'on ouvre
pour regarder. Même règle que l'extraction du lot 9.

## Brancher Claude Code sur la mémoire (lot 10) — les gestes de Marc

Tu as choisi l'envoi AUTOMATIQUE (ADR 0002 §4, question C). Trois gestes, dans cet ordre :

1. **Poser le jeton** dans Vercel → `memory-ai` → Environment Variables :
   `MEMORYAI_TOKEN_CLAUDECODE_ECRITURE` = `openssl rand -base64 24`. **Puis redéployer** — une
   variable posée sans redéploiement ne change rien (vécu le 15/09 sur `AUTH_SECRET`).
2. **Essayer à la main d'abord**, sur une session déjà finie, pour voir ce qui part :
   ```bash
   export MEMORYAI_URL="https://memoryai.hubperso.com"
   export MEMORYAI_TOKEN_CLAUDECODE_ECRITURE="…"   # la valeur du point 1
   node scripts/pousser-session.mjs ~/.claude/projects/<projet>/<session>.jsonl --dry-run
   ```
   `--dry-run` n'envoie RIEN : il affiche combien de messages partiraient et combien de blocs
   d'outils sont ignorés. Retire `--dry-run` quand le compte te paraît juste.
3. **Le hook**, une fois le point 2 satisfaisant. Il vit dans `~/.claude/settings.json` (pas
   dans ce dépôt : tu veux TOUTES tes sessions, pas seulement celles de MemoryAI) :
   ```json
   {
     "hooks": {
       "Stop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "node /chemin/vers/MemoryAI/scripts/pousser-session.mjs \"$CLAUDE_TRANSCRIPT_PATH\""
             }
           ]
         }
       ]
     }
   }
   ```
   Les deux variables d'environnement doivent être visibles du hook (profil, ou `env` dans le
   réglage). ⚠️ Je ne peux pas écrire dans `~/.claude/` depuis cette session : c'est ton geste.

⚠️ **Ce qui ne part JAMAIS, et c'est tenu par deux barrières.** Le script ne retient que les
blocs `type: "text"` — les diffs, les fichiers lus et les sorties de commandes ne quittent pas
ta machine. Et le serveur REFUSE (`resultat_outil_interdit`) un corps qui en porterait un, même
imbriqué. Le scan de secrets tourne en plus, côté serveur, avant le chiffrement.

⚠️ **Le risque que j'ai nommé reste entier** : le scan est une heuristique, personne ne relit
avant l'envoi. Si tu veux voir ce qui est parti : `/conversations`.

## Ce qui attend un geste de Marc

Aucune de ces valeurs ne se génère dans un commit ni ne se colle dans le chat. Chacune se
pose dans **Vercel → memory-ai → Settings → Environment Variables** (Production).

| Variable | Rôle | Comment l'obtenir |
|---|---|---|
| `AUTH_SECRET` | déchiffre le cookie de session du hub | **la MÊME valeur que le projet `hubperso`** (Vercel → hubperso → Environment Variables). Différente ⇒ boucle sur `/login` sans erreur |
| `AUTH_COOKIE_DOMAIN` | cookie partagé | `.hubperso.com` — en production SEULEMENT |
| `AUTHORIZED_EMAIL` | le propriétaire | ton adresse |
| `DATABASE_URL` | Neon | console Neon → nouveau projet → chaîne de connexion (pooled) |
| `MEMORYAI_CHIFFREMENT` | clé AES-256-GCM des faits N1+ | `openssl rand -base64 32` |
| `MEMORYAI_JOURNAL_CLE` | HMAC du journal d'accès (distincte de la précédente) | `openssl rand -base64 32` |
| `MCP_SIGNING_KEY` | signature des jetons OAuth du MCP (≥ 32 car.) | `openssl rand -base64 32` |
| `MCP_ACCESS_KEY` | la clé que tu saisis une fois dans claude.ai (≥ 16 car.) | `openssl rand -base64 24` |
| `ANTHROPIC_API_KEY` | clé **dédiée** à MemoryAI | console.anthropic.com → API keys → nouvelle clé nommée `memoryai` |
| `HUB_TOKEN` | le hub lit `/hub/summary` | `openssl rand -base64 24`, et la MÊME valeur dans `HUB_TOKEN_MEMORYAI` côté hub |
| `MEMORYAI_TOKEN_<APP>_ECRITURE` | un par écrivain (ex. `MEMORYAI_TOKEN_DRIVEAI_ECRITURE`) ; l'app et le rôle sont lus dans le NOM de la variable | `openssl rand -base64 24` — rien à poser en phase 0, sauf `MEMORYAI_TOKEN_SEED_ECRITURE` pour le lot 6 |
| `MEMORYAI_N2_CHAT` | autorise le chat à servir des faits N2 | à poser à `1` **seulement après** avoir lu la rétention dans console.anthropic.com → Settings → Privacy. Inconnue au 15/09 |

Et hors variables : le connecteur MCP dans claude.ai, le domaine, et le projet Neon.

### Brancher claude.ai sur la mémoire (lot 4) — les gestes de Marc

1. Poser `MCP_SIGNING_KEY` (≥ 32 car.) et `MCP_ACCESS_KEY` (≥ 16 car., **aléatoire**, jamais une
   phrase choisie — c'est la seule porte devinable) dans Vercel, puis redéployer.
2. Vérifier depuis un navigateur : `https://memoryai.hubperso.com/api/mcp` doit répondre
   `{ "configure": true, "gele": false }` (405, c'est normal : le MCP parle en POST).
3. claude.ai → Réglages → Connecteurs → *Ajouter un connecteur personnalisé* → URL
   `https://memoryai.hubperso.com/api/mcp`. claude.ai découvre OAuth tout seul et ouvre la
   page « Autoriser Claude à lire la mémoire » : y saisir `MCP_ACCESS_KEY`.
4. Preuve du lot : dans une conversation, `memoryai_etat` répond avec les compteurs.

Ce que claude.ai voit : les faits N0 et N1 (validés ET proposés, étiquetés), les faits N3 sans
contenu (existence, date, pointeur Drive). Les faits N2 seulement si l'outil est appelé avec
`inclure_n2: true` **et** que `MEMORYAI_N2_CHAT=1` est posée — chaque appel est journalisé avec
le niveau maximal servi. Un canari, un rejeté, un périmé, un supprimé : jamais.

## Envoyer le seed (lot 6) — les gestes de Marc

1. Poser `MEMORYAI_TOKEN_SEED_ECRITURE` (`openssl rand -base64 24`) dans Vercel → memory-ai,
   puis redéployer (Vercel fige les variables au build).
2. Depuis le PC, dans un clone du dépôt à jour (`npm ci`), avec le fichier reçu dans la
   session posé en `seed/faits.local.json` :
   `MEMORYAI_URL=https://memoryai.hubperso.com MEMORYAI_TOKEN_SEED_ECRITURE=… node scripts/seed.mjs seed/faits.local.json`
   — ou donner la variable à l'environnement de la session Claude, qui l'enverra elle-même.
3. Ouvrir `/a-valider` sur le téléphone : 105 faits « proposés », fiabilité `seed`. Valider,
   rejeter ou oublier un par un. Ce que dit la confiance : 1 = tiré de tes propres règles ;
   0,5 = lu dans un document illisible, à relire (les dates du bail de logement).
4. Retirer `MEMORYAI_TOKEN_SEED_ECRITURE` de Vercel une fois le seed envoyé.

Preuve de la Q20 (a), dans claude.ai, une fois trois faits validés : « où est mon avis de
cotisation 2024 ? » → `memoryai_chercher` rend le fait `fiscal.avis` avec son lien Drive ;
« quand finit mon bail ? » → `vehicule.bail.fin = 2031-01-15` (CarAI) et
`logement.bail.fin` (à confirmer sur le document), chacun avec sa provenance.

## Le contrat d'écriture, en deux lignes (lot 3)

`POST /api/faits`, `Authorization: Bearer <jeton>`, corps `{ faits: [ … ≤ 50 ] }`, chaque fait
= `{ sujet: "marc", predicat, valeur, valeur_type, valide_de?, valide_a?, niveau_propose?,
confiance?, fiabilite_source?, attributs?, provenance: { source_type, source_ref, extracteur,
date_source?, dossier?, type_document? } }`. Réponse `{ recus, acceptes, dejaPresents,
refuses: [{ index, code, raison }] }`. Les codes de refus sont énumérés dans
`lib/validerFait.ts` (`CODES_REFUS`) ; le corpus `tests/adversarial.test.ts` en est la doc
vivante. Une panne (503 nommé) n'est jamais un refus (401, muet).

## Ce que Marc peut faire depuis son téléphone (lot 5)

`/a-valider` liste les faits proposés, déchiffrés à l'écran et nulle part ailleurs. Trois
gestes, trois formulaires (ils marchent sans JavaScript) : **Valider** (servi comme sûr ; pour
un prédicat non multiple, l'ancien fait validé passe `perime`), **Rejeter** (gardé, jamais
servi, et un rejeu de la même source ne le re-propose pas), **Oublier** (supprimé, inscrit dans
`oublis` : il ne revient pas). `/moi` porte les comptes, l'état des variables (N2, MCP, chat)
et la purge totale — mot `SUPPRIMER`, vérifié côté serveur. Le chat (`/chat`) vit dans
l'onglet (`sessionStorage`) ; « Épingler » sur une réponse crée un fait `propose`, fiabilité
`marc`, à confirmer dans « À valider ».

## Pièges connus

- ⚠️ Le projet Vercel tourne en **Node 24.x** alors que `.nvmrc` dit 22 et que la CI suit
  `.nvmrc`. Pas un problème aujourd'hui ; le jour où une API `node:*` diverge, c'est là.
- ⚠️ `AUTH_SECRET` différent du hub = aucune erreur, juste une boucle sur `/login`.
- ⚠️ Le limiteur d'échecs de `/api/mcp/authorize` est un FILET FAIBLE en serverless (une
  instance par requête) : la vraie barrière est l'entropie de `MCP_ACCESS_KEY`. En cas de
  doute, faire tourner `MCP_SIGNING_KEY` invalide tous les jetons émis.
- ⚠️ L'anti-rejeu des codes OAuth est en mémoire d'instance (best-effort, hérité de CarAI) ; ce
  qui borne vraiment est la durée de vie du code (10 min) et son lien PKCE/client/redirect.
- ⚠️ Le chat compte chaque appel AVANT de lire la réponse et relit le budget en base avant
  chaque appel, y compris entre deux tours d'outils : deux onglets ne partagent aucun
  compteur en mémoire. Le jour du plafond est celui du Québec, pas celui du serveur.
- ⚠️ Le détecteur de consignes (`lib/canari.ts`) attrape des FORMES, pas le sens : une consigne
  en français courant peut passer. C'est le balisage à la lecture (lot 4) qui fait le reste.
- ⚠️⚠️ **Un plafond du contrat REFUSE le summary entier, il ne tronque pas.** `details[].items`
  est borné à 8 par `@mokarade/hub-contract` ; le code coupait à 12, un chiffre écrit à la
  main. Invisible tant que la mémoire avait moins de neuf domaines : la validation des 98
  premiers faits a rendu la branche atteignable et `/hub/summary` est passé en `500` — carte
  du hub en erreur, mémoire parfaitement saine. Corrigé le 15/09 : sept domaines plus une
  ligne « N autres domaines » qui porte la somme du reste, pour que le total des lignes
  égale toujours la métrique « Faits validés » affichée à côté. Les tests d'alors passaient
  DEUX domaines ; ceux d'aujourd'hui exercent la frontière (8 et 9) et vingt domaines.
- ⚠️⚠️ **`form-action` de la CSP couvre la CHAÎNE DE REDIRECTION, pas seulement la première
  cible.** La page de consentement du connecteur poste vers elle-même puis redirige vers
  Claude avec le code : avec `form-action 'self'` seul, le navigateur bloque cette
  redirection **sans rien afficher**. Le serveur répond `302`, l'écran ne bouge pas, et ça
  ressemble à « le bouton ne marche pas ». Mesuré le 15/09 : dix-huit `POST /api/mcp/authorize`
  en `302`, et **zéro** appel à `/api/mcp/token`. Corrigé, verrouillé par `tests/csp.test.ts`,
  qui exige en plus que la directive et l'allowlist de `lib/mcp/oauth.ts` disent la même chose.
- ⚠️ **Une variable posée APRÈS le dernier déploiement n'existe pas** pour ce qui est servi :
  Vercel les fige au déploiement, et le middleware les embarque dans son bundle edge. Poser
  PUIS redéployer, toujours. Vécu le 15/09 : `AUTH_SECRET` posée, `503 MissingSecret` pendant
  vingt minutes, réglé par un redéploiement et rien d'autre.
- ⚠️ **Le diagnostic le plus rapide n'est pas dans le code, il est dans les journaux
  runtime Vercel** : ils nomment la cause en une ligne (`MissingSecret`, puis
  `no matching decryption secret` sur le cookie précédent, puis `200`). Deux pannes de mise en
  service ont été tranchées comme ça le 15/09, sans toucher au code. Depuis une session Claude,
  `get_runtime_logs` du connecteur Vercel ; le réseau vers `memoryai.hubperso.com`, lui, est
  refusé par le proxy — une session ne peut pas tester l'app en direct.
- ⚠️ **DriveAI et FinanceAI ne partagent PAS la session du hub**, et ce n'est pas un oubli :
  DriveAI a son propre OAuth Google avec un verrou `ALLOWED_EMAIL` au callback, FinanceAI vit
  dans le navigateur du PC. Les cinq apps qui partagent `AUTH_SECRET` sont `hubperso`, `job-ai`,
  `car-ai`, `batchchef-glu8` et `memory-ai` — ce sont elles, et elles seules, qu'une rotation
  de ce secret oblige à redéployer ensemble.
- ⚠️ Les déploiements de `claude/*` sont désactivés : **il n'existe aucune préversion** d'une
  PR ouverte par une session. Le seul endroit où voir le rendu est la production, après merge.

### Le plafond d'un contrat se DÉRIVE, il ne se recopie pas (15/09, 21 h 19)

`details[].items` est borné à **8** par `@mokarade/hub-contract`, et `validateSummary` refuse
le summary ENTIER plutôt que de tronquer. `lib/hubSummary.ts` coupait à 12 — un chiffre écrit
à la main, jamais confronté au schéma. La branche était **inatteignable** tant que la mémoire
avait moins de neuf domaines ; valider les 98 premiers faits l'a rendue atteignable, et la
carte du hub est passée en erreur pendant que la mémoire allait parfaitement bien.

Ce que les tests ne pouvaient pas voir : ils passaient deux domaines. Ce qui l'a trouvé : les
journaux runtime Vercel, qui nomment l'erreur au mot près. Corrigé par `itemsParDomaine`
(sept domaines, puis une ligne « N autres domaines » qui porte la somme du reste — sans elle,
le total des lignes contredirait la métrique « Faits validés » affichée juste à côté).

⚠️ **Classe à chercher ailleurs** : un plafond de contrat recopié au lieu d'être dérivé, et
qu'aucune fixture n'atteint. C'est la quatrième cause de cette soirée à n'apparaître qu'une
fois la précédente réparée — domaine, `AUTH_SECRET`, CSP `form-action`, puis celle-ci.

### Dans un fichier `"use server"`, un `export` est une décision (15/09, 21 h 55)

Le lot 7 exportait un objet `MARC` (l'écrivain « c'est Marc qui répond ») depuis
`app/questions/actions.ts`. Typecheck vert, lint vert, 286 tests verts — et **le build casse
à la collecte des pages** : « A "use server" file can only export async functions ».

C'est le pendant de la leçon JobAI, où un `export` de trop dans un fichier `"use server"`
OUVRE une route HTTP anonyme. Ici il ne l'ouvre pas, il casse le build. Dans les deux cas, la
règle est la même : **dans un fichier `"use server"`, un `export` n'est pas un choix de
portée, c'est une déclaration au framework.**

⚠️ Ce qui rend le cas coûteux, c'est l'ORDRE du gate : le défaut survit au typecheck et aux
tests, et n'apparaît qu'au build. Un gate qui s'arrêterait aux trois premiers l'aurait laissé
passer jusqu'à Vercel.


### Une iframe ne redirige pas : elle blanchit (15/09, 22 h 55)

`CLAUDE.md` §1 promettait qu'« un invité d'une app hôte voit l'iframe et reçoit un 403
lisible ». Le code du lot 12 attrapait bien `NonAutorise` dans `app/widget/page.tsx` pour
l'écrire dans le cadre — sauf que **ce `catch` n'était jamais atteint**. Le refus d'un invité
se décide un cran plus haut, au callback `jwt` d'`auth.ts`, qui rend `null` pour toute adresse
autre que celle du propriétaire : `req.auth` est alors faux, et le middleware REDIRIGE vers
`/login`, qui renvoie au hub, lequel porte `frame-ancestors 'none'`. Dans un cadre, une
redirection vers une page qui refuse d'être cadrée ne donne pas une page de connexion : elle
donne un **rectangle blanc**, sans erreur, sans explication, indiscernable d'une panne.

Corrigé par `ROUTES_CADREES` (`lib/authGuard.ts`) : pour `/widget` et lui seul, un refus rend
la page au lieu de partir en redirection. Ce n'est **pas** une exclusion du matcher (le
matcher n'a pas bougé) ni un `isPublicPath` (la page ne sert rien sans session) — c'est le
SORT DU REFUS qui change, rien d'autre.

⚠️ **Ce que ça coûte, et il faut le savoir** : la sécurité de cette page repose entièrement
sur son `requireSession()`, puisque le middleware la laisse traverser. Deux tests gardent la
concession dans les deux sens — retirer la règle, ou la passer d'une égalité à un préfixe,
font rougir deux tests différents.

⚠️ **La classe à chercher ailleurs** : une phrase de documentation qui décrit un comportement
attendu (« l'utilisateur voit tel message ») alors que la couche qui décide vraiment est plus
haut dans la pile. Elle se vérifie en suivant le chemin du REFUS, jamais celui du succès —
le chemin du succès marchait parfaitement.

### Un graphe qui n'explique pas ses traits ne s'audite pas (15/09, 23 h 10)

Le premier réflexe, pour un graphe, est de dessiner : des nœuds, des traits, une force qui
pousse. Mais un trait qui ne dit pas d'où il vient ne se vérifie pas — on le croit ou on
l'ignore, et les deux sont mauvais pour une mémoire dont tout le projet est d'être reprise et
corrigée par Marc. D'où l'ordre choisi ici : d'abord les RÈGLES (déterministes, testées une par
une, chacune portant sa phrase), la forme ensuite.

Ce que ça a rendu visible tout de suite, et qu'un dessin aurait caché :

- **le quadratique** — huit faits qui partagent un émetteur font 28 liens, quarante en font
  780. Les règles de groupe s'abstiennent au-delà de huit, et l'abstention est affichée ;
- **l'écart** — la table est une photo du dernier recalcul, les faits bougent. La page compare
  et le dit, au lieu de se présenter comme à jour ;
- **l'orientation** — `remplacement` et `cause-declaree` portent un SENS ; les normaliser comme
  les trois autres règles inverserait le lien, et le graphe dirait le contraire de ce qui s'est
  passé. C'est la mutation qui l'a prouvé, pas la relecture.

## Portes qualité de l'Atelier (S6, 23/09/2026)

Contrôles automatiques en CI, jobs **Qualité** et **Sécurité** : la fusion automatique les attend.
Principe du **cliquet** : `qualite/seuils.json` fige l'état du jour de la mise en place ; rien ne peut
reculer. `npm run portes` mesure en local, `npm run portes:maj` resserre après une amélioration.

Portes : typage, lint (erreurs et avertissements), tests en échec, couverture `lib/` (% lignes),
couverture globale (% lignes et % branches), code mort (knip), règles d'architecture (dependency-cruiser).
Les seuils vivent dans `qualite/seuils.json` (la source qui fait foi, datée par `mis_a_jour`) : ils partent
de la mesure et ne font que monter. Resserrés sur la mesure le 16/10/2026 (tâche #124) ; la couverture
s'affiche dans le journal du job Qualité, et une baisse y rend la porte rouge (`RECUL`, sortie 1).

Sécurité : gitleaks sur tout l'historique + Semgrep (TypeScript, React, Next.js, secrets, OWASP), bloquants.
Dependabot : mises à jour hebdomadaires (npm + actions), fusion automatique si tout est vert.

## 2026-10-01 : fusion native (P1)
Le kit d'auto-fusion maison (workflow, config, modeles/auto-merge, COPIES.md) est retire : GitHub fusionne seul (auto-merge natif + controles requis). CODEOWNERS ajoute ; Dependabot attend 3 jours.
