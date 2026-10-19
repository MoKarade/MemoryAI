<!-- Extrait de l'ancien CLAUDE.md (1. Principes non négociables), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# 1. Principes non négociables

- **Une frontière nommée, pas une permission nue** (ADR 0001). Des FAITS TYPÉS sur Marc sont
  persistés hors de son compte Google. Ce qui ne franchit JAMAIS la frontière, verrouillé par
  test : aucun texte source (un fait = une valeur ≤ 200 caractères + un pointeur), **jamais un
  montant** (`valeur_type: "montant"` ⇒ 422 — FinanceAI reste la source des chiffres), aucune
  valeur de niveau 3 (identité, immigration, fiscal : existence, type, date, échéance,
  pointeur, rien d'autre), aucune position GPS, aucune adresse de tiers, aucun numéro
  d'identité.
- **MemoryAI ne détient aucun jeton.** Pas de refresh token Google, pas de jeton d'app, pas de
  coffre. Un jeton = une app = un rôle (lecture OU écriture) = un périmètre étroit ; **jeton
  inconnu ⇒ périmètre vide**, pas une erreur bavarde. Un `MCP_TOKEN` statique a été retiré de
  JobAI avec ce commentaire : « exactement le genre de porte qu'on oublie de refermer ».
- **Le vocabulaire des faits GRANDIT, et ce qui est neuf ATTEND** (ADR 0004 §2.3, décision de
  Marc du 16/09). ⚠️ L'ADR 0001 posait un vocabulaire FERMÉ et cette ligne l'a écrit jusqu'au
  16/09 ; ce n'est plus vrai, et c'est le seul point de la défense n° 1 qui bouge. Un prédicat
  hors vocabulaire n'est **jamais refusé, jamais perdu** : il entre, il est cherchable, il
  s'affiche — et il n'est **JAMAIS servi à un modèle** tant qu'il n'est pas sorti de
  quarantaine, par Marc d'un clic (`/a-valider`) ou par **trois extracteurs DISTINCTS**.
  Ce qui tient le compromis, et qu'aucune refacto ne doit défaire : le plancher de niveau 2
  d'un prédicat inconnu (`NIVEAU_PLANCHER_QUARANTAINE` — 0 ferait sortir un texte arbitraire
  en clair) ; `refuse` ABSORBANT (trois sources n'annulent pas une décision de Marc) ; et le
  paramètre `predicatsRetenus` de `estServable`, **REQUIS** pour que le compilateur énumère
  les consommateurs — optionnel, son défaut serait « rien n'est retenu », c'est-à-dire le
  côté dangereux. ⚠️ `REFUS_STRUCTURELS` reste au-dessus : position, coordonnées, adresse de
  tiers, numéro d'identité n'entrent dans AUCUNE version, ni en quarantaine.
- **Injection par les faits = menace n° 1.** Elle a déjà tué une mémoire d'assistant dans cet
  écosystème (Era, FinanceAI). À l'écriture : `validerFait()` PURE — Zod strict, vocabulaire
  fermé et versionné, longueurs, refus des URL / retours à la ligne / balises, drapeau
  `canari`, `fiabilite_source` et `statut` **déduits du jeton**, `niveau = MAX(code, LLM)`.
  À la lecture : un fait est rendu **en résultat d'outil**, balisé, **jamais dans un prompt
  système**. Un corpus adversarial tourne en CI, prouvé par mutation.
- **Une garde n'existe qu'aux endroits qui la consultent.** Le niveau calculé au plan ne
  protège rien s'il n'est pas ré-appliqué au point d'écriture par la MÊME fonction. Pour chaque
  « jamais » de l'ADR, montrer la ligne qui le re-vérifie juste avant l'insertion — et la
  neutraliser mentalement : si la suite reste verte, la garde n'est pas testée.
- **`oublis` avant toute insertion, sur TOUS les chemins.** Un fait oublié ne revient ni par
  le rejeu, ni par le rattrapage, ni par le flux. ⚠️ **Et il faut pouvoir en POSER un** : jusqu'au
  17/09, `empreinteOubliPiece` était écrite, testée et commentée, et aucune surface ne
  l'appelait — pas de page, pas d'outil, et le bouton « oublier » de `/a-valider` ne vise que
  les FAITS. Le retrait d'une pièce vit désormais sur la FICHE du papier (`/pieces/<id>`,
  `lib/pieces/depotOubli.ts`) :
  empreinte sur TOUS les exemplaires, AVANT la suppression. Un repli qu'on croit avoir est un
  repli qu'on n'a pas.
- **Un fait MÉCANIQUE est `valide` d'emblée** (ADR 0003, décision de Marc du 16/09). ⚠️ L'ADR
  0001 §5.1 posait « le statut est `propose` » sans exception ; l'ADR 0003 l'AMENDE pour les
  couples (extracteur, prédicat) de `COUPLES_MECANIQUES` — un seul aujourd'hui,
  `moteur-inventaire-v1` × `document.existe`, soit ~**4 240** faits que l'inventaire DriveAI
  pousse (⚠️ cette ligne portait « ~19 900 » : c'était un compte de CLÉS d'Index, re-mesuré par
  DriveAI C49-4 le 17/09 — et 4 240 est un PLANCHER, tout ce qui entre par Gmail étant invisible
  à ce canal). **La règle porte sur la PROVENANCE, jamais sur le contenu** : ce fait n'a jamais vu
  de modèle, il n'y a rien à relire. Ce qui ne bouge PAS : le NIVEAU reste dérivé par le code
  (auto-valider n'ouvre aucun accès), un **canari ne s'auto-valide jamais**, et un fait que
  Marc a REJETÉ ne se fait pas re-valider. Le rattrapage du stock est en SQL
  (`drizzle/0007_…`) — donc une SECONDE écriture de la règle, tenue par un test qui dérive les
  couples du CODE et exige que chacun soit couvert par une migration.
- **Le NIVEAU 3 peut sortir, sous DEUX verrous** (ADR 0007, décision de Marc du 19/09/2026 :
  « pour tous les docs niveau 3 max tout tout tout »). ⚠️ Cette ligne a dit « aucune valeur de
  niveau 3 » jusqu'au 19/09 ; ce n'est plus vrai, et c'est le seul point de la défense n° 1 qui
  bouge. Ce qui l'a déclenché est un défaut observé : la Mémoire portait le passeport de Marc et
  répondait « je ne trouve pas de date de naissance » — « je ne sais pas » et « je sais et je ne
  dis pas » appellent deux gestes opposés. Le plafond `niveauMaxServi` atteint 3 **seulement**
  si `MEMORYAI_N3_CHAT=1` (hors produit) ET `inclure_n3` (par appel, posé par la bascule de la
  conversation, qui ÉCRASE ce que le modèle demande). La variable seule servirait un passeport à
  chaque question, MCP compris — et le MCP s'authentifie par jeton, pas par la session de Marc.
  ⚠️ Le plafond est **MONOTONE** : demander N3 sert aussi N2. ⚠️ Ça ne change RIEN aux faits —
  un fait N3 n'a jamais de contenu (`validerFait` le refuse, la base aussi) ; ce qui s'ouvre, ce
  sont les colonnes chiffrées d'une **pièce**. ⚠️ Livré FERMÉ des deux côtés, et **sans la
  re-authentification** que Marc évoquait le 16/09 : elle n'existe nulle part ici (mesuré), il a
  choisi d'ouvrir sans elle. `tests/niveau3.test.ts`, discrimination prouvée par trois mutations.
  ⚠️⚠️ **ADR 0011 (24/09) : un TROISIÈME verrou, le LECTEUR.** Mesuré ce jour-là : le MCP
  servait les numéros du passeport à tout client OAuth, parce que le second verrou
  (`inclure_n3`) était, côté MCP, à la main du MODÈLE appelant. N3 ne sort désormais qu'aux
  lecteurs de `LECTEURS_N3` (`lib/lecture.ts`) — le chat, et lui seul —, vérifié dans
  `politique()`. **Une liste BLANCHE** : un lecteur ajouté plus tard est fermé tant que personne
  ne l'a décidé. Les facettes suivent (un titulaire de passeport est un nom). Dans le chat, la
  case est cochée PAR DÉFAUT (« seulement moi, mais ouvert par défaut », Marc). Le plein texte
  des papiers N3 se fait EN MÉMOIRE pour ce seul lecteur, jamais en base.
  `tests/niveau3Lecteurs.test.ts`, sept mutations rouges.
- **App privée, SANS invité, jamais.** `providers: []`, propriétaire seul (`AUTHORIZED_EMAIL`,
  vérifié sans réseau). `lib/accesHub.ts` du gabarit est supprimé, et un test refuse sa
  réintroduction. Un invité d'une app hôte voit l'iframe et reçoit un 403 lisible.
- **No fake data.** `status: "building"` au hub tant qu'aucun fait n'est validé ; un écran
  vide dit POURQUOI il est vide (« aucune source branchée ») au lieu de ressembler à une panne.
  Un chiffre plausible à la place d'une mesure absente est interdit.
- **Le budget est de 3 $/jour, RÉPARTI et NOMMÉ** (arbitrage de Marc, 16/09) : chat 1 $ ·
  apprentissage 2 $ (`lib/coutChat.ts`, et la somme des postes est verrouillée par test — relever
  un poste OBLIGE à prendre à l'autre, ou à rouvrir le total avec Marc). Le poste est obligatoire
  partout : un défaut ferait tomber l'apprentissage dans le budget du chat sans que personne ne le
  voie. Compté au site d'appel AVANT la validation de la réponse — l'appel est facturé même quand
  le schéma refuse. « Épingler » crée un fait `propose`.
- **La mémoire APPREND seule, et une passe DIT toujours pourquoi elle s'arrête** (lot 16).
  Deux déclencheurs qui ne font pas la même chose : la fin d'un tour de chat lit UNE conversation
  (`apprendreDeLaConversation`, dans un `after()`, après que la réponse est partie), le cron
  quotidien fait une passe complète (`POST /api/cron/apprentissage`, secret DÉDIÉ `CRON_SECRET` —
  503 s'il manque côté serveur, 401 s'il est faux). Lancer une passe complète à chaque tour de chat
  coûterait le budget d'une journée en une soirée. ⚠️ Six motifs de fin DISTINCTS
  (`MOTIFS_FIN_PASSE`, unicité testée) : « rien à lire » et « budget épuisé » n'appellent pas le
  même geste, et les confondre est exactement la panne que DriveAI a payée le 16/09 — une étape
  qui sortait sans écrire une ligne. Un gel, une base ou une clé absentes rendent `200` avec leur
  motif : un planificateur qui rougit chaque jour pour une intégration éteinte apprend à être ignoré.
- **Le producteur de questions ne voit AUCUNE valeur** (`lib/questions/producteur.ts`). Il reçoit
  le vocabulaire et, par prédicat, le nombre de faits VALIDÉS — rien d'autre. Pas de déchiffrement,
  pas de niveau à arbitrer, rien à baliser : la surface d'injection est nulle parce qu'aucun texte
  écrit par quelqu'un d'autre n'entre dans ce prompt. « `sante.allergie` : 0 fait » ne dit rien sur
  Marc, ça dit ce que la mémoire ignore. ⚠️ Le plafond de cinq ouvertes et la dédup restent
  appliqués par `depotQuestions.poser` — la garde qui décide est celle que le point d'ÉCRITURE
  consulte —, et une file déjà pleine ne déclenche AUCUN appel.
- **Les conversations SONT gardées, en texte intégral chiffré** (ADR 0002 §2, décision de Marc
  du 15/09). ⚠️ Cette ligne disait « aucune conversation persistée » jusqu'au 15/09 : c'était
  l'ADR 0001 §5.5, et l'ADR 0002 l'AMENDE — c'est le seul point de la frontière qui bouge.
  Ce qui ne bouge PAS : la frontière sur les documents et les mails reste entière, une
  conversation ne devient jamais un fait directement (elle passe par `validerFait` comme tout
  le reste), elle n'entre dans AUCUN périmètre d'app, et aucun outil MCP ne la rend. Ce qu'on
  obtient en échange : un **scan de secrets AVANT chiffrement**
  (`lib/conversations/secrets.ts`, PUR, corpus positif ET négatif prouvé par mutation), un
  **AAD qui scelle la position** (`conversation|source|index`), et « oublier » par le même
  chemin qu'un fait. Le scan est une HEURISTIQUE : il attrape les formes connues, il ne
  garantit rien.
- **`GET /api/etat` rend des NOMBRES à une app qui alimente la mémoire, jamais son contenu**
  (23/09/2026). Marc, devant l'onglet « Lecture » de DriveAI : « manque des infos sur ce qui est
  validé SÉPARÉMENT par driveai et memory ai ». DriveAI sait ce qu'il a ENVOYÉ et rien de ce que
  c'est DEVENU — d'où une page qui laissait croire que la seconde grandeur n'existait pas. La
  route publie faits validés / en attente / migrés, papiers **lus** contre **importés seulement**
  (`comptesParExtracteur` — le critère est l'EXTRACTEUR, jamais `domaine IS NULL`), et le total
  par la source unique. Jeton de **lecture** suffisant, 401 indiscernables, `no-store`, et elle
  est déclarée dans `ROUTES_A_AUTH_PROPRE` **et** dans le matcher — sous le garde de session,
  DriveAI recevrait du HTML au lieu du JSON (piège n° 1 du squelette).
  ⚠️ **Le gel ne la bloque PAS, il est publié** : `MEMORYAI_GEL` arrête ce qui ÉCRIT, et répondre
  503 ici cacherait l'état au moment précis où l'on cherche pourquoi plus rien n'avance.
  ⚠️ Une base injoignable rend **503**, jamais des zéros — un cumul à 0 se lit « la mémoire est
  vide », le plus alarmant des faits, là où la vérité est « je n'ai pas pu lire ».
- **Contrat d'abord** pour `/hub/summary` (`@mokarade/hub-contract`) ; `no-store` ; jeton en
  temps constant ; 503 sans `HUB_TOKEN`, 401 sinon. **Cette route reste HORS du middleware**
  (piège n° 1 du gabarit, vécu par JobAI : sous le garde, le hub reçoit une redirection HTML
  et affiche « injoignable » alors que l'app marche).
