# Accès aux données, route par route

Inventaire au 28/10/2026, avant le retrait des niveaux prévu par l’ADR 0034. Les gardes ci-dessous sont celles présentes dans le code aujourd’hui; cette liste ne remplace pas leur vérification au point d’entrée.

## Classes

| Classe | Porte réellement vérifiée |
|---|---|
| `session-proprietaire` | Session du hub revérifiée par `requireSession()` (`lib/session.ts`), en plus du garde de requête (`middleware.ts`, `lib/authGuard.ts`). |
| `jeton-proprietaire` | OAuth MCP : clé d’accès pour autoriser le propriétaire, puis code/jeton OAuth validé (`app/api/mcp/authorize/route.ts`, `app/api/mcp/token/route.ts`, `app/api/mcp/route.ts`). |
| `jeton-app` | Jeton d’application et rôle/périmètre (`lib/jetons.ts`); les routes du hub vérifient leur jeton partagé et, quand prévu, `proprietaire: true`. |
| `secret-cron` | `CRON_SECRET`, comparé en temps constant dans la route cron. |
| `public-sans-donnee` | Surface de découverte, d’authentification ou de connexion; elle ne lit ni ne renvoie de faits, de pièces ou de comptes de faits. |

## Routes HTTP

| Route (fichier) | Classe | Données lues ou écrites | Garde constatée |
|---|---|---|---|
| `/api/agenda` (`app/api/agenda/route.ts`) | `jeton-app` | Écrit les événements d’agenda; ne renvoie pas leur contenu. | `ecrivainAutorise()` dans la route; contrat et dépôt dans `lib/agenda/contrat.ts`, `lib/agenda/depot.ts`. |
| `/api/ask` (`app/api/ask/route.ts`) | `jeton-app` | Lit le contexte mémoire demandé pour la réponse de LIA. | `jetonsEgaux()` sur le jeton du hub; `proprietaire: true` est imposé dans la route. |
| `/api/auth/*` (`app/api/auth/[...nextauth]/route.ts`) | `public-sans-donnee` | Établit ou consulte une session Auth.js; aucune lecture de la mémoire. | Handlers Auth.js (`auth.ts`); l’adresse autorisée est vérifiée par `isAuthorizedEmail()`. |
| `/api/avancement` (`app/api/avancement/route.ts`) | `jeton-app` | Écrit l’avancement et ses comptes, sans contenu de fait. | `ecrivainAutorise()` dans la route, contrat de `lib/avancement.ts`. |
| `/api/chat` (`app/api/chat/route.ts`) | `session-proprietaire` | Lit les faits, pièces et conversations utiles; peut écrire une conversation ou un fait épinglé. | `requireSession()` dans la route; orchestration dans `lib/chat/agent.ts`. |
| `/api/conversations` (`app/api/conversations/route.ts`) | `jeton-app` | Reçoit et écrit les conversations envoyées par une application. | `ecrivainAutorise()` dans la route; dépôt chiffré `lib/conversations/depot.ts`. |
| `/api/cron/apprentissage` (`app/api/cron/apprentissage/route.ts`) | `secret-cron` | Lit des faits, conversations et extraits de pièces; écrit les résultats d’apprentissage et de relecture. | `CRON_SECRET` vérifié avec `timingSafeEqual()` dans la route. |
| `/api/cron/reseau` (`app/api/cron/reseau/route.ts`) | `secret-cron` | Lit les faits et écrit les liens calculés; la réponse rend des comptes d’exécution. | `CRON_SECRET` vérifié avec `timingSafeEqual()` dans la route. |
| `/api/demandes` (`app/api/demandes/route.ts`) | `jeton-app` | Lit et écrit les demandes; le nom est chiffré et n’entre pas dans un prompt. | Jeton du hub comparé par `jetonsEgaux()` et vérification de propriété dans la route. |
| `/api/etat-lia` (`app/api/etat-lia/route.ts`) | `jeton-app` | Lit ou écrit l’état partagé de LIA, pas les faits de la mémoire. | Jeton du hub comparé par `jetonsEgaux()` et vérification de propriété dans la route. |
| `/api/etat` (`app/api/etat/route.ts`) | `jeton-app` | Lit des agrégats et renvoie des nombres d’état; jamais les valeurs des faits ou le contenu des pièces. | `identifierEcrivain()` dans la route exige un jeton de lecture. |
| `/api/evenements` (`app/api/evenements/route.ts`) | `jeton-app` | Écrit les événements transmis par une application. | `ecrivainAutorise()` dans la route. |
| `/api/faits` (`app/api/faits/route.ts`) | `jeton-app` | Écrit les faits transmis par une application après validation du contrat. | `ecrivainAutorise()` dans la route; validation dans `lib/ecrireFaits.ts`. |
| `/api/lia/ask` (`app/api/lia/ask/route.ts`) | `session-proprietaire` | Lit le contexte mémoire demandé par LIA pour répondre depuis la maison. | Session vérifiée par `requireSession()`; contexte dans `lib/lia/ask.ts`. |
| `/api/lia/etat` (`app/api/lia/etat/route.ts`) | `session-proprietaire` | Lit ou met à jour l’état partagé de LIA. | `requireSession()` dans la route. |
| `/api/mcp/authorize` (`app/api/mcp/authorize/route.ts`) | `jeton-proprietaire` | Affiche la demande d’autorisation; échange la clé du propriétaire contre un code, sans lire la mémoire. | `ctx.auth.authorize()` valide la clé et la requête OAuth (`lib/mcp/oauth.ts`). |
| `/api/mcp/meta/as` (`app/api/mcp/meta/as/route.ts`) | `public-sans-donnee` | Renvoie les métadonnées publiques de découverte OAuth. | Aucune session ni jeton; réponse produite par `reponseMetadonnees()` (`lib/mcp/metadonnees.ts`), sans accès à la base. |
| `/api/mcp/meta/pr` (`app/api/mcp/meta/pr/route.ts`) | `public-sans-donnee` | Renvoie les métadonnées publiques de ressource OAuth. | Aucune session ni jeton; réponse produite par `reponseMetadonnees()` (`lib/mcp/metadonnees.ts`), sans accès à la base. |
| `/api/mcp/register` (`app/api/mcp/register/route.ts`) | `public-sans-donnee` | Enregistre un client OAuth; pas de base ni de données mémoire. | Inscription DCR sans stockage; allowlist des redirections dans `lib/mcp/oauth.ts`. |
| `/api/mcp` (`app/api/mcp/route.ts`) | `jeton-proprietaire` | Lit les faits, pièces, questions, conversations et notes proposés par les outils; certains outils peuvent écrire un fait proposé ou une conversation. | `verifyAccessToken()` dans la route, implémenté par `lib/mcp/oauth.ts`. |
| `/api/mcp/token` (`app/api/mcp/token/route.ts`) | `jeton-proprietaire` | Échange un code ou renouvelle un jeton; ne lit pas la mémoire. | `exchangeCode()` ou `refreshGrant()` valide le flux OAuth (`lib/mcp/oauth.ts`). |
| `/api/pieces/file` (`app/api/pieces/file/route.ts`) | `jeton-app` | Lit ou remplace le contenu binaire d’une pièce selon la méthode. | `ecrivainAutorise()` dans la route; lecture/écriture des pièces dans `lib/pieces/`. |
| `/api/pieces/relecture` (`app/api/pieces/relecture/route.ts`) | `jeton-app` | Lit la file de relecture ou écrit une lecture et ses empreintes; les réponses de file ne contiennent pas le texte de la pièce. | `ecrivainAutorise()` dans la route; garde métier dans `lib/pieces/secondeLecture.ts`. |
| `/api/pieces` (`app/api/pieces/route.ts`) | `jeton-app` | Écrit les métadonnées et le contenu de pièces reçues d’une application. | `ecrivainAutorise()` dans la route; contrat dans `lib/pieces/`. |
| `/api/sorties` (`app/api/sorties/route.ts`) | `jeton-app` | Écrit les sorties d’applications selon le contrat fermé; ne lit pas les faits. | `ecrivainAutorise()` dans la route; liste et contrat dans `lib/sorties/contrat.ts`. |
| `/hub/summary` (`app/hub/summary/route.ts`) | `jeton-app` | Lit et renvoie le résumé agrégé attendu par le hub, sans valeur de fait. | `serveSummary()` valide le jeton et le contrat (`lib/hubSummary.ts`). |

Les routes publiques de découverte, Auth.js et connexion ne consultent pas `lib/db` et ne rendent pas de fait, de pièce ni de nombre de faits. Les deux routes de métadonnées, l’inscription OAuth et la page de connexion sont exercées sur leur réponse ou leur rendu dans `tests/accesRoutes.test.ts`.

## Pages

Toutes les pages ci-dessous, sauf `/login`, appellent `requireSession()` côté serveur dans leur fichier `page.tsx`. `/login` est la seule page publique et redirige vers le hub ou affiche l’état de configuration, sans lire la mémoire.

| Page (fichier) | Classe | Données affichées ou surface proposée |
|---|---|---|
| `/` (`app/page.tsx`) | `session-proprietaire` | Accueil et état de LIA. |
| `/a-valider` (`app/a-valider/page.tsx`) | `session-proprietaire` | Faits en attente et gestes de validation. |
| `/apps` (`app/apps/page.tsx`) | `session-proprietaire` | Applications et état de leurs accès. |
| `/avancement` (`app/avancement/page.tsx`) | `session-proprietaire` | Avancement et comptes par source. |
| `/chat` (`app/chat/page.tsx`) | `session-proprietaire` | Conversation avec LIA et résultats mémoire demandés. |
| `/conversations` (`app/conversations/page.tsx`) | `session-proprietaire` | Conversations enregistrées et extraction demandée. |
| `/depenses` (`app/depenses/page.tsx`) | `session-proprietaire` | Dépenses et plafonds, sans clé secrète. |
| `/fait/[id]` (`app/fait/[id]/page.tsx`) | `session-proprietaire` | Fiche et provenance d’un fait. |
| `/graphe` (`app/graphe/page.tsx`) | `session-proprietaire` | Faits et liens du graphe. |
| `/login` (`app/login/page.tsx`) | `public-sans-donnee` | Page de connexion/redirection, sans contenu mémoire. |
| `/memoire` (`app/memoire/page.tsx`) | `session-proprietaire` | État, faits et comptes de la mémoire. |
| `/memoire/acces` (`app/memoire/acces/page.tsx`) | `session-proprietaire` | Journal des accès à la mémoire. |
| `/memoire/apprentissage` (`app/memoire/apprentissage/page.tsx`) | `session-proprietaire` | File et comptes d’apprentissage et de relecture. |
| `/memoire/historique` (`app/memoire/historique/page.tsx`) | `session-proprietaire` | Historique des traitements. |
| `/memoire/reseau` (`app/memoire/reseau/page.tsx`) | `session-proprietaire` | Liens entre faits. |
| `/moi` (`app/moi/page.tsx`) | `session-proprietaire` | État privé et gestes sur les données du propriétaire. |
| `/partage` (`app/partage/page.tsx`) | `session-proprietaire` | État du partage et de la session. |
| `/pieces` (`app/pieces/page.tsx`) | `session-proprietaire` | Liste des pièces et état de lecture. |
| `/pieces/[id]` (`app/pieces/[id]/page.tsx`) | `session-proprietaire` | Fiche et contenu d’une pièce. |
| `/questions` (`app/questions/page.tsx`) | `session-proprietaire` | Questions de la mémoire et réponses en attente. |
| `/regler` (`app/regler/page.tsx`) | `session-proprietaire` | Réglages, état des gardes et catalogue. |
| `/regler/sauvetage` (`app/regler/sauvetage/page.tsx`) | `session-proprietaire` | État du sauvetage et outils de reprise. |
| `/widget` (`app/widget/page.tsx`) | `session-proprietaire` | Widget de lecture et de conversation avec LIA. |

## Server Actions

Chaque fichier ci-dessous contient une directive `"use server"` et revérifie la session dans ses actions; la garde commune est `requireSession()` (`lib/session.ts`).

| Fichier | Classe | Lecture ou écriture |
|---|---|---|
| `app/apps/actions.ts` | `session-proprietaire` | Gestes de gestion des applications et de leurs accès. |
| `app/a-valider/actions.ts` | `session-proprietaire` | Valider, rejeter, oublier ou trancher un fait; traiter une pile de pièces. |
| `app/chat/actions.ts` | `session-proprietaire` | Épingler une réponse et lire/ouvrir une conversation. |
| `app/conversations/actions.ts` | `session-proprietaire` | Oublier une conversation. |
| `app/conversations/extraireAction.ts` | `session-proprietaire` | Lire la conversation choisie et demander l’extraction de faits. |
| `app/depenses/actions.ts` | `session-proprietaire` | Modifier un plafond de dépense. |
| `app/fait/[id]/actions.ts` | `session-proprietaire` | Corriger un fait après validation du contrat. |
| `app/graphe/actions.ts` | `session-proprietaire` | Recalculer les liens du graphe. |
| `app/idees/actions.ts` | `session-proprietaire` | Enregistrer ou traiter les gestes proposés par LIA. |
| `app/moi/actions.ts` | `session-proprietaire` | Purger les données du propriétaire après confirmation. |
| `app/pieces/actions.ts` | `session-proprietaire` | Oublier une pièce. |
| `app/questions/actions.ts` | `session-proprietaire` | Répondre, choisir ou écarter une question; juger une carte. |
| `app/regler/actions.ts` | `session-proprietaire` | Modifier les réglages de LIA et son frein. |
| `app/regler/sauvetage/actions.ts` | `session-proprietaire` | Exécuter les gestes confirmés du sauvetage. |

## Ce qui part chez Anthropic

- **Chat** — `/api/chat` appelle `tourDeChat()` (`lib/chat/agent.ts`). Le prompt et les résultats d’outils peuvent contenir les faits et pièces réellement lus, la conversation et les éléments de contexte nécessaires à la réponse; ils sont envoyés à l’API Messages d’Anthropic. La lecture est journalisée par `journaliserAcces()` (`lib/journalAcces.ts`).
- **LIA** — `/api/lia/ask` et `/api/ask` appellent `repondreLia()` (`lib/lia/repondre.ts`), qui passe par le même agent. Le contexte mémoire et les résultats d’outils lus pour répondre sont envoyés à Anthropic; la session ou le jeton du hub protège l’entrée, pas la rétention chez le fournisseur.
- **Extraction et apprentissage** — `app/conversations/extraireAction.ts` lit la conversation choisie et `lib/conversations/extraction.ts` envoie les extraits nécessaires à l’extraction. `/api/cron/apprentissage` déclenche aussi les passes de `lib/apprentissage.ts` et `lib/relectureLia.ts`, qui peuvent envoyer à Anthropic des extraits de source et les faits à relire.
- **claude.ai** — il n’y a pas d’appel Anthropic serveur-à-serveur depuis `/api/mcp`. claude.ai s’authentifie par OAuth et reçoit, dans les résultats des outils de `/api/mcp`, les valeurs de faits ou de pièces que l’outil a lues. Ces résultats sont en clair pour le modèle de claude.ai et peuvent être réutilisés dans sa réponse ou par un autre connecteur.

Conformément à l’ADR 0034, « privé à Marc » désigne qui peut accéder à la mémoire, pas une promesse que les données lues par un modèle restent chez Neon. Le niveau d’accès est encore appliqué par le code actuel; son retrait relève de la tâche #434. L’inventaire n’a révélé aucune route ouverte renvoyant des données de mémoire.
