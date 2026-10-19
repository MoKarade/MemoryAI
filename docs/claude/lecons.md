<!-- Extrait de l'ancien CLAUDE.md (9. Leçons apprises), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# 9. Leçons apprises

Héritées du gabarit, et vraies ici :

1. **`/hub/summary` reste HORS du middleware** (voir §1).
2. **Le hub polle toutes les ~15 s** : si produire le summary coûte une requête lourde, un
   cache court dans le handler — jamais une panne en cache.
3. **Un `undefined` dans une addition empoisonne TOUT le cumul** : normaliser à `0` à l'entrée.
4. **Une donnée illisible se COMPTE, elle ne se rabat pas sur zéro.**
5. ⚠️⚠️ **Exclure un fait de ce qui est SERVI ne suffit pas s'il occupe la place avant
   d'être exclu** (18/09/2026). `faits()` ordonnait par `desc(creeLe)` avec `limite: 500` et ne
   filtrait que `supprimeLe` ; les ~2 729 `document.existe` migrés en pièces sont les plus
   RÉCENTS, donc ils prenaient toute la fenêtre. `estServable` les écartait bien — **après** le
   `LIMIT`. Mesuré en production : `memoryai_contexte` sans filtre de domaine servait **2 faits
   sur 99 validés** ; avec un filtre excluant le domaine `document`, **27**. C'est cette PAIRE
   de mesures qui nomme le défaut — un seul chiffre aurait laissé croire à une base vide.
   ⚠️ **C'était la plainte de Marc du 17/09** (« on dirait qu'elle a pas beaucoup d'info sur
   moi ») : elle était exacte et désignait un défaut de REQUÊTE, pas un manque de données.
   ⚠️ Et `comptes()` portait DÉJÀ le bon prédicat, avec un commentaire disant que les deux
   conditions vont « ENSEMBLE partout » — mais il était écrit DANS `comptes()`. Classe
   `CORRIGER-UN-PRODUCTEUR-N-EST-PAS-CORRIGER-LA-CLASSE` : le lot qui a réparé les COMPTEURS a
   laissé la requête que le MODÈLE lit. Le prédicat est désormais `conditionServis()`, écrit une
   fois, consommé aux deux endroits. Garde : `tests/evictionMigres.test.ts`.
   ⚠️ **Un filtre de lecture qui vit dans un prédicat TypeScript et pas dans le SQL est une
   garde qui tire trop tard.**
6. ⚠️ **Un compteur calculé puis détruit par déstructuration n'est pas une protection**
   (18/09/2026). `rendreServables` rend `retenus` (les faits écartés par la quarantaine du
   vocabulaire) et son commentaire dit pourquoi : « « aucun fait » et « des faits, mais leur
   prédicat attend » ne disent pas la même chose, et seul le second désigne un geste ».
   `lireEtFiltrer` écrivait `const { faits, illisibles } = …` — le compte partait dans le vide,
   donc un modèle concluait « la mémoire ne sait rien » là où la réponse était « va accepter ces
   prédicats ». Désormais dans `noteEcartes()`, avec ses deux causes DISTINCTES et un contrôle
   négatif (rien d'écarté ⇒ note VIDE : un avertissement permanent est un avertissement mort).
7. ⚠️⚠️ **Ne JAMAIS faire d'aller-retour d'un fichier UTF-8 par PowerShell**
   (`Get-Content -Raw` puis `WriteAllText`) — 18/09/2026, vécu. `Get-Content` a lu `lib/depotLecture.ts`
   en ANSI et la réécriture l'a encodé en UTF-8 : **tous** les accents du fichier sont devenus
   doublement encodés (`é` → `Ã©`, `⚠️` → `âš ï¸`), soit 85 lignes de diff pour une perturbation
   d'une ligne. Le signal était un `git diff --stat` **hors de proportion** avec l'édition
   voulue — pas un message d'erreur, il n'y en a eu aucun. Une perturbation de mesure s'écrit
   en Python avec `encoding='utf8'` explicite, et se contrôle par
   `grep -c` sur un caractère mojibake avant de committer.
8. ⚠️ **Trier par longueur empêche la valeur longue d'être COUPÉE, pas d'être POLLUÉE**
   (18/09/2026, trouvé **par le test**, pas par la relecture). `annoterReponse` relie les
   valeurs servies de la plus longue à la plus courte, ce qui évite bien qu'une courte
   coupe une longue en deux. Mais « Québec » s'appariait toujours **à l'intérieur** de
   « America/Toronto (heure du Québec) » et y glissait son lien avant la parenthèse
   fermante — le texte d'une valeur servie coupé par le lien d'une AUTRE. Le tri est
   nécessaire et **pas suffisant** : il faut un registre des zones consommées. Et mon
   commentaire disait « couperait la seconde en deux », ce qui décrivait un sous-cas —
   corrigé en même temps que le code, parce qu'un commentaire qui décrit une protection
   partielle dispense de chercher le reste.
   ⚠️ Corollaire d'écriture : les insertions se **COLLECTENT** puis s'appliquent de la FIN
   vers le DÉBUT. Posées au fil de l'eau, chacune décale les positions déjà calculées et le
   décalage se cumule — un défaut qui ne se voit qu'à partir de la deuxième insertion.
9. ⚠️ **Une ancre multi-lignes ne matche RIEN dans ce dépôt** (18/09/2026, payé trois
   fois dans la même session). `core.autocrlf = true` : les fichiers arrivent en **CRLF** au
   checkout, donc une ancre de remplacement écrite avec `
` entre deux lignes est absente
   du fichier. Le symptôme est un « ancre introuvable » sur une chaîne qu'on vient de LIRE à
   l'écran, ce qui pousse à soupçonner l'accent ou l'apostrophe — j'ai perdu trois tours
   là-dessus. Règle : **une ancre par LIGNE**, lecture et écriture en `newline=''` pour
   préserver les fins de ligne, et le saut de ligne **DÉRIVÉ** du fichier (`"
" if "
"
   in s else "
"`) jamais supposé. Une écriture qui normalise produit un diff de tout le
   fichier, ce qui masque l'édition réelle.

10. ⚠️⚠️ **Une garde qui appelle un module avec une entrée FABRIQUÉE à la main ne teste pas
    le code qui CONSTRUIT cette entrée** (18/09/2026 — révélé par une perturbation MUETTE).
    Marc : « j'ai pas les liens pour les documents ». Cause : un fait `type="ref_document"`
    a pour VALEUR un fileId Drive opaque, jamais écrit par un modèle ; son libellé humain
    vit dans `attributs.type`. L'appariement par valeur ne POUVAIT pas tirer — sur la
    majorité de sa donnée (2 729 papiers).
    ⚠️ Le correctif tenait en une ligne (`etiquette` construite depuis `attributs.type`), et
    **le remettre à `f.valeur` laissait mes 30 gardes VERTES** — mesuré. Toutes appelaient
    `annoterReponse` avec un `FaitServi` écrit à la main : elles testaient le module et
    jamais son alimentation. Un trou entre deux moitiés testées n'appartient à personne.
    Parade : au moins UNE garde qui TRAVERSE depuis l'entrée la plus amont (ici un vrai fait
    en base, servi par un vrai outil, dans un vrai tour de chat) — et c'est la PERTURBATION
    qui l'a exigée, pas la relecture.
    ⚠️ Corollaire général : **apparier sur ce que le modèle ÉCRIT, jamais sur ce que la base
    STOCKE.** Les deux coïncident pour un fait ordinaire et divergent pour tout ce qui est
    référence, identifiant ou clé technique.

11. **Un appel recopié du voisin arrive SANS sa précondition** (18/09, L26a). `/chat/page.tsx`
    appelait `requireSession()` — le patron des treize autres pages — sans déclarer
    `export const dynamic = "force-dynamic"`. Next a donc tenté de la **PRÉRENDRE** au build,
    l'export a levé `NonAutorisé`, et `npm run build` a échoué — après `typecheck`, `lint` et
    quatre gardes neuves tous VERTS. Mesuré après coup : **13 pages sur 14** la déclaraient,
    `/login` comprise, qui n'appelle même pas `requireSession()` — donc la règle est
    universelle, et l'oubli était le mien seul. ⚠️ Ce qui en fait plus qu'une panne de build :
    **une page prérendue est servie depuis un CACHE, à tout le monde**. Pour une app dont
    chaque page lit la mémoire d'une personne, c'est la pire issue possible, et elle serait
    SILENCIEUSE si le rendu statique avait réussi : le build n'a crié que parce que la garde
    de session lève. Un garde-fou qui casse le build est un garde-fou CHANCEUX, pas un
    garde-fou. La règle est donc une garde d'une seconde (`tests/gardePages.test.ts`).
    ⚠️ Et la leçon de conduite : un appel, dans une page Next, n'est pas une ligne — c'est un
    contrat avec le mode de rendu. Avant de recopier un appel d'une page voisine, lire ce que
    cette page DÉCLARE autour de lui, pas seulement ce qu'elle appelle.
12. **Une barre de navigation se garde sur l'ATTEIGNABILITÉ, pas sur le nombre d'entrées**
    (18/09, L26a). Passer de huit onglets à trois se vérifie mal par un compteur — un ratchet
    sur un compte se périme au premier lot qui ajoute une section légitime. Les deux faits qui
    rendent la réduction honnête sont : chaque entrée mène à un `page.tsx` qui EXISTE (« un
    onglet qui ne mène nulle part est pire qu'un onglet en moins » — c'est pourquoi **Voir**
    attend L30 : aucune requête d'échéances n'existe, mesuré), et aucune page ne DISPARAÎT de
    la barre en silence. ⚠️ `tsc` couvre déjà l'exhaustivité de la table (`Record<CleNav, …>`) :
    la garde ne réécrit que ce qu'il ne peut pas voir — un `href` vers un dossier sans page,
    et une clé mise à `null` par oubli plutôt que par décision (exemption NOMMÉE, avec son
    contrôle anti-fantôme).

13. **Une donnée absente de l'écran est souvent ÉCRITE, et seulement JETÉE par la couche de
    lecture** (18/09, L33a). Marc demandait « voir le document lié, ou tous les documents
    liés », et le réflexe est d'aller écrire une requête. Mesuré avant de coder :
    `provenances.source_ref` est `notNull` **et INDEXÉ** (`provenances_source`, index posé
    exactement pour retrouver les faits d'une même source) — et `rendreLisible` ne le
    recopiait pas dans `FaitLisible`. La demande était à un CHAMP de distance. Deux moitiés
    correctes (une colonne écrite, un index posé) et aucune surface entre les deux : un trou
    entre deux moitiés ne appartient à personne, et rien ne pouvait rougir. **Devant une
    donnée qu'aucun écran ne montre, remonter le chemin à l'envers — la colonne, l'index, la
    fonction de lecture — avant de supposer qu'elle n'existe pas.**
14. **Avant d'écrire une table de libellés, chercher si le dépôt en porte déjà un** (18/09,
    L33a). « Full retravailler comment ça affiche les faits » avait l'air de demander une
    phrase par prédicat. Le vocabulaire en portait une depuis l'origine —
    `d("logement.bail.fin", …, "Fin du bail")` — et `CarteFait` l'affichait en `hint` SOUS
    la valeur pendant que le nom MACHINE occupait l'en-tête. Le lot est donc une INVERSION de
    ce qui est dominant, pas une table neuve. ⚠️ Et écrire la table aurait été pire qu'inutile :
    elle aurait divergé en silence de la description, qui reste la source unique. **Quand une
    demande d'affichage semble réclamer du texte neuf, demander d'abord où le texte JUSTE est
    déjà rangé, et à quelle place il s'affiche.** Corollaire appliqué aux types de liens :
    leur libellé humain est un `Record` EXHAUSTIF sur `TYPES_LIEN`, donc une règle ajoutée
    plus tard casse le typecheck au lieu d'afficher `meme-domaine-meme-entite` à Marc.
15. ⚠⚠ **Une garde écrite d'après un COMMENTAIRE hérite de son erreur** (18/09, L33a —
    démasqué par une perturbation MUETTE). Mon repli précoce portait « on rend la liste VIDE
    plutôt que de balayer toute la table sur une chaîne nulle », et j'ai écrit la garde
    d'après cette phrase : appeler avec `""` et attendre `[]`. Or `where source_ref = ''` ne
    matche AUCUNE ligne écrite par le contrat (`min(1)`) — donc retirer le repli laissait la
    garde VERTE. Le commentaire SUR-PROMETTAIT, et la garde ne mesurait rien. Le risque réel
    était plus étroit : la COLONNE accepte la chaîne vide (`notNull` ne l'interdit pas), donc
    deux lignes posées hors du contrat se rattacheraient au motif qu'elles n'ont pas de
    source. Les deux ont été corrigés — le commentaire ET la garde, avec deux orphelins
    insérés en SQL brut. **Une garde se dérive du MÉCANISME, jamais de la phrase qui le
    décrit** ; et une perturbation muette accuse d'abord la perturbation, ensuite la fixture,
    et en dernier la garde — ici, sur deux muettes, une était de chaque sorte.
16. **Un `var(--token)` non DÉCLARÉ est un no-op silencieux** (18/09, L33a). J'ai écrit
    `var(--texte)` là où le token s'appelle `--text`. Rien n'a crié : `tsc` ne lit pas le
    CSS, ESLint non plus, le build passe, la page s'affiche — juste sans la couleur. Ça ne se
    voit qu'à l'œil, par quelqu'un qui sait de quelle couleur la page devrait être. Même
    classe que le `text-ink-600` hors palette de FinanceAI. Désormais gardé dans
    `tests/couleurs.test.ts` : tout token employé est un token déclaré, avec son
    anti-vacuité des deux côtés.
17. **Une contrainte `CHECK` est une MESURE de ce que le domaine autorise** (18/09, L33a). Mon
    cas de test « un lien vers une question où le fait est en B » a été refusé DEUX fois par
    le schéma, et chaque refus a appris quelque chose : `liens.fait_a` porte une clé
    étrangère vers `faits` et `fait_b` non, donc un identifiant de question ne peut être
    qu'en B — mon scénario était **impossible** ; puis
    `check("liens_question_seulement_cause")` n'autorise un tel lien QU'AVEC le type
    `cause-declaree`, donc la branche « ce n'est pas un fait » n'est atteignable que par ce
    type-là. **Un cas que la base REFUSE enseigne la forme du domaine ; le réécrire d'après
    ce refus vaut mieux que le contourner** — et la décision qui en dépendait a quitté le JSX
    pour un module pur (`autreExtremite`), où elle se perturbe sans monter React.

18. ⚠⚠ **Un ADR annoncé se re-mesure comme un défaut : le mécanisme existait déjà** (18/09,
    L33b). J'avais routé « corriger un fait » vers un ADR au motif §11 — ça touche le
    contrat d'écriture. Mesuré avant d'écrire : ça n'y touche pas. `ecrireLot(…, MARC, …)`
    est le chemin par lequel Marc écrit depuis le lot des questions, et `admin.valider`
    PÈRIME déjà tout seul les autres faits validés du même prédicat non `multi` — écrit et
    commenté dans son corps, et `choisirOptionAction` s'en sert exactement comme ça.
    Corriger, c'est **écrire la bonne valeur et la valider**. ⚠️ La question qui tranche
    n'est pas « ce geste ressemble-t-il à une frontière ? » mais **« quel champ, quel
    mutateur, quelle table n'existe pas encore ? »** — et l'ADR aurait délibéré sur une
    décision déjà prise par le schéma. Le vrai risque était l'inverse : inventer un chemin
    d'écriture parallèle à côté de celui qui marche. Corollaire : la même passe a trouvé ce
    qui EXIGE un ADR (`remplaceId`, `[L33d]`) — il est LU par la règle de graphe
    `remplacement` et **écrit par personne** en production, donc cette règle ne peut pas
    tirer. **Troisième fois de la journée que la réponse est « la capacité existe, le FIL
    manque »** (le filtre de `depotLecture`, `source_ref`, la correction).
19. **Un `plafond` n'est pas une VALEUR** (18/09, L33b — perturbation MUETTE). Pour prouver
    que la fiabilité d'une correction reste « marc », j'ai élargi `Ecrivain.fiabilites` à
    `["marc", "document-officiel"]` — et la garde est restée VERTE. `fiabilites` est un
    **plafond** (une liste blanche vérifiée par `fiabilite_hors_plafond`) ; la valeur, elle,
    vient du champ `fiabilite_source` de l'ENTRÉE, absent dans mon cas. La perturbation
    juste était de recopier `ancien.fait.fiabiliteSource` dans l'entrée **et** d'élargir le
    plafond qui l'autorise — c'est-à-dire le défaut plausible d'un lot futur qui croirait
    « garder la provenance ». **Devant un champ gardé par une liste blanche, perturber la
    VALEUR et la PERMISSION ensemble : l'une seule ne bouge rien.** Et ce que la garde
    défend est une affirmation : une correction tapée par Marc n'a pas la fiabilité d'un
    document officiel, **même quand elle corrige un document officiel**.

20. ⚠⚠ **Déplacer du contenu déplace son INVALIDATION, et `revalidatePath` est une liste
    qui ne suit aucun refactor** (18/09, L26b). Les compteurs ont quitté `/moi` pour
    `/regler`. Mesuré juste après : **dix** Server Actions invalidaient encore `/moi`, et
    **zéro** invalidait `/regler`. ⚠️ Rien n'aurait rougi, et la raison est instructive : ces
    pages sont `force-dynamic`, donc le serveur les re-rend à chaque requête et le défaut est
    INVISIBLE côté serveur. Il ne se voit qu'en navigation CLIENT, où Next sert le payload
    RSC gardé en cache : Marc valide un fait, revient sur Régler par la barre, et lit un
    compteur d'avant son geste. **Après avoir déplacé un affichage, grep qui INVALIDAIT son
    ancienne adresse** — la question n'est pas « qui le lit ? » mais « qui le rafraîchit ? ».
    Et le remède n'est pas dix corrections mais une SOURCE UNIQUE
    (`app/rafraichirCompteurs.ts`) : dix listes à tenir à jour, c'est une garantie qui repose
    sur la vigilance.
21. ⚠⚠ **Un `<details>` masque à l'œil mais EXPÉDIE son contenu** (18/09, L26b). C'est ce
    qui a fait renoncer à fusionner les CONVERSATIONS dans Régler : replié ou non, le HTML
    est rendu et part au navigateur, donc les résumés de conversations auraient été dans la
    source du hub à chaque chargement, alors qu'aujourd'hui ils ne sont lus que si Marc va
    les voir. **Un repli est une commodité d'AFFICHAGE, jamais une frontière de DONNÉES.**
    Le test qui tranche avant d'inliner quoi que ce soit : *est-ce que je serais à l'aise que
    ce contenu soit dans la source de la page pour tout le monde qui l'ouvre ?* Corollaire
    dans l'autre sens, et c'est la même propriété vue à l'envers : un dépli ne rend pas un
    geste plus DIFFICILE non plus — la purge garde sa page pour ça.
22. **Le périmètre qu'on écrit soi-même se recense comme celui des autres** (18/09, L26b).
    L26a avait écrit « les cinq pages portent 16 actions serveur », en nommant chacune.
    Recensé au lot suivant : **12** — les quatre autres appartiennent à `/questions`,
    `/chat` et `/pieces`, qui ne sont PAS dans Régler. J'avais listé les actions de
    l'application en croyant lister celles d'un onglet. « Un périmètre cité n'est pas un
    périmètre recensé » ne fait **aucune exception pour la fraîcheur ni pour l'auteur** : un
    périmètre de la veille, écrit par moi, dimensionnait le lot d'aujourd'hui à 30 % de trop.

23. ⚠⚠ **Une garde qui épingle une VALEUR ne voit pas que cette valeur a cessé de désigner
    la bonne chose** (18/09, L26b — trouvé par le panel, après gate vert ET PR ouverte).
    `app/manifest.ts` portait `start_url: "/moi"`, juste quand `/moi` était l'accueil
    fonctionnel. L26a a déplacé l'accueil vers la conversation, L26b a fait de `/moi` la seule
    page de PURGE — et lancer l'app INSTALLÉE plaçait Marc droit devant « Effacer toute la
    mémoire », l'exact contraire de ce que je venais d'écrire dans ce fichier-là.
    ⚠️ `tests/partage.test.ts` asserait `expect(m.start_url).toBe("/moi")` : la garde
    **CERTIFIAIT** le défaut au lieu de l'attraper, et comptait comme protection dans tout
    inventaire. Variante de `UNE-GARDE-QUI-NE-PEUT-PAS-TIRER`, appliquée à un MANIFESTE —
    et un manifeste, personne ne le relit (déjà payé ici sur `background_color`). Correctif :
    **DÉRIVER** (`SECTIONS[0].href`), pour qu'un lot qui déplace l'accueil emmène le
    manifeste avec lui. **Après avoir changé ce qu'une adresse CONTIENT, grep qui la
    DÉSIGNE** — manifeste, service worker, redirections, liens, `revalidatePath` : la
    question n'est pas « qui lit cette page ? » mais « qui promet qu'elle est autre chose ? ».
24. ⚠⚠ **Une ancre de garde doit être UNIQUE dans sa surface** (18/09, L26b — panel, deux
    trous sur six ancres, chacun prouvé par mutation). `"comptes()"` était satisfait par la
    lecture des PAPIERS quand celle des FAITS disparaissait (deux `.comptes()` à trois lignes
    d'écart) ; `"purgerAction"` était satisfait par un COMMENTAIRE quand le formulaire perdait
    son action. Le fait vedette de la page n'avait donc AUCUNE garde, et le piège
    `SCAN-QUI-MATCHE-LA-PROSE` a été commis **trois lignes sous l'en-tête qui dit vouloir
    l'éviter**. ⚠️ Et le correctif n'est pas de réparer deux ancres : c'est d'exiger
    l'UNICITÉ de chacune, parce qu'**une ancre qui désigne deux sites ne peut pas dire lequel
    a disparu**. Réparer les cas trouvés laisse la classe ouverte pour la prochaine ancre
    écrite au jugé. ⚠️ Corollaire du même lot, même cause : j'ai écrit « `/regler` fetchait
    déjà **4** des 5 lectures » sans compter — c'était **3**. Un chiffre dans un commentaire
    d'architecture ne décore pas : il sert à DIMENSIONNER le prochain lot, donc il se mesure
    comme n'importe quelle autre affirmation.

25. ⚠⚠ **« Non désactivable » et « non réglable » ne sont pas la même règle** (18/09, L34).
    L'ADR 0001 §5.5 dit « plafond dur, NON DÉSACTIVABLE » (Q15), et Marc a demandé de régler
    ses plafonds dans l'app. Lu vite, c'est une contradiction ; lu précisément, non : ce qui
    est interdit est de l'ÉTEINDRE. Et le test qui verrouillait la somme des postes disait
    LUI-MÊME que relever un poste oblige « à rouvrir le total avec Marc, ce qui est une
    décision de dépense et pas un effet de bord » — autrement dit, le garde-fou nommait
    exactement le geste que Marc vient de faire. **Devant une règle verrouillée qui semble
    interdire la demande, relire AU MOT ce qu'elle interdit, puis ce que sa garde dit
    d'elle-même** — ici la garde nommait sa propre condition de levée. Ce qui a été tenu :
    un plafond EXISTE toujours (absence = défaut, jamais « illimité »), il est toujours
    CONSULTÉ (argument REQUIS, donc `tsc` énumère les sites au lieu d'un défaut muet), et il
    est BORNÉ dans le code ET dans la base. ⚠️ Corollaire : `Infinity` est le plafond
    désactivé écrit autrement, et il passe un `!isNaN` — c'est `Number.isFinite` qu'il faut.
26. **Un plafond qui devient dynamique rend FAUX tous les textes qui le citaient** (18/09,
    L34). Deux classes d'erreur interpolaient la constante dans leur message : « Plafond du
    chat atteint : 1,20 $ sur **1** $ » aurait été dit à quelqu'un qui en a mis cinq. Un texte
    affiché est une affirmation, et celle-là sert à décider s'il faut relever le plafond —
    donc elle doit citer CELUI QUI A COUPÉ. **Après avoir rendu une constante dynamique, grep
    les endroits qui l'INTERPOLENT, pas seulement ceux qui la lisent** : `tsc` trouve les
    seconds, jamais les premiers — un message compile toujours.
27. **Quand la base REFUSE le scénario, la question suivante est « alors quel chemin
    reste-t-il ? »** (18/09, L34 — 3ᵉ fois de la journée qu'un schéma réfute un de mes cas de
    test). J'écrivais « une colonne altérée rend `NaN`, et le repli le rabat sur le défaut » :
    or `NaN >= 0 AND NaN <= 50` n'est pas vrai, donc `CHECK` refuse la ligne. La garantie
    réelle était plus forte que celle que je testais. ⚠️ Mais le repli n'est pas mort, et il
    faut l'ÉCRIRE : il protège le chemin du FORMULAIRE, où `Number(fd.get(…))` rend `NaN` sur
    n'importe quelle saisie. Sans cette phrase, le code de repli passe pour mort et se fait
    retirer au lot suivant.
28. **Deux des trois points d'une grande demande étaient DÉJÀ bâtis** (18/09). Marc a demandé
    « une base de donnée avec toutes les infos » et « une recherche simple, limite sur
    telephone ». Mesuré avant de cadrer : la table `pieces` porte déjà les facettes keyées,
    les dates, le résumé, `champsStructures` et `champsLibres` (dont le commentaire dit « c'est
    ici, et seulement ici, que *je veux tout* vit sans vocabulaire ») ; et la recherche est
    déjà `to_tsvector('french', …)` + facettes — du Postgres, **aucun modèle pour trouver**.
    Ce qui manquait était le DÉBIT : **83 papiers lus sur 2 728**. **Devant une demande
    d'architecture, mesurer l'existant AVANT de proposer un plan** : les deux tiers de
    celle-là se sont réduits à « c'est fait, et voici où ça vit », et le tiers restant était
    dans un AUTRE dépôt. ⚠️ Corollaire : la contrainte que Marc énonce (« recherche simple »)
    est déjà l'architecture, donc elle n'a pas besoin d'être construite — elle a besoin
    d'être **ÉCRITE** (`[L37]`), sinon quelqu'un ajoutera des embeddings « pour améliorer la
    recherche » et la tuera sans que personne ne l'ait décidé.
29. ⚠⚠ **Sur un tableau de bord, la grandeur la plus utile n'est presque jamais celle qu'on
    a demandée** (18/09, L38). Marc voulait « ce qui reste, ce qui a été traité ». Or un
    import ARRÊTÉ depuis trois semaines et un import qui AVANCE ont exactement la même barre
    de progression : la grandeur qui les distingue est « rien n'a été lu depuis N jours »,
    que personne n'avait demandée. **Devant une demande de suivi, chercher ce que deux états
    OPPOSÉS afficheraient de la même façon** — c'est là qu'est la mesure manquante, et c'est
    la troisième fois que ce dépôt la paie sous le nom de « signal de fraîcheur mort ».
30. ⚠⚠ **Deux rythmes répondent à deux questions différentes, et prendre le mauvais fabrique
    une estimation CONFIANTE et fausse** (18/09, L38). Sur les données réelles : 83 documents
    lus en UNE journée il y a trois semaines. « Total ÷ jours écoulés » = 4/jour → « il reste
    670 jours », ce qui donne l'impression que ça progresse ; « total ÷ jours ACTIFS » =
    83/jour → « environ 32 jours où l'import tourne ». Les deux chiffres sont VRAIS ; un seul
    répond à la question posée. ⚠️ Et l'unité de l'estimation doit le dire : « il reste 32
    jours » laisserait croire que ça se fera tout seul en trente-deux nuits, alors que ça
    dépend du nombre de fois où l'import TOURNERA. ⚠️ Corollaires gardés : un rythme nul ne
    donne pas `Infinity` mais AUCUNE estimation, et un pourcentage sur un total nul n'est pas
    « 0 % » mais « rien à mesurer » — `NaN.toFixed(1)` affiche « NaN », un mot là où tout le
    reste est un chiffre.
31. ⚠⚠ **UNE ANCRE D'ÉDITION DOIT ÊTRE UNIQUE, exactement comme une ancre de GARDE** (18/09,
    L38). J'ai remplacé un bloc entre `deb` (la section) et `fin = index("</main>")` — or le
    RETOUR ANTICIPÉ de la page a lui aussi un `</main>`, donc `fin < deb` et **toute la page
    s'est dupliquée** (211 → 510 lignes). C'est la leçon d'unicité que la revue m'avait
    apprise le matin même sur des ancres de TEST, repayée le soir sur une ancre d'ÉDITION.
    Parade : compter les occurrences avant de remplacer, et **vérifier que `deb < fin`** — un
    intervalle inversé ne lève aucune erreur, il duplique en silence. ⚠️ Corollaire
    d'outillage du même lot : un heredoc de gros volume avec des apostrophes casse le shell,
    et `\\` y est mangé — un script d'édition qui contient des antislashs s'ÉCRIT dans un
    fichier (ou construit ses antislashs par `chr(92)`), il ne se passe pas en heredoc.
32. ⚠⚠ **Un scan qui vérifie les TOKENS ne vérifie pas leurs RATIOS** (18/09, L38).
    `tests/couleurs.test.ts` garantissait qu'aucune couleur n'est écrite en dur et que tout
    token employé est déclaré — et **aucun ratio de contraste n'était calculé nulle part**
    (`npm run check-contrast` appartient à FinanceAI, pas à ce dépôt). Deux paires neuves ont
    donc été mesurées une fois par un audit ponctuel, et plus rien ne les aurait relues au
    prochain ajustement de `globals.css` : **une mesure qui ne se rejoue pas est un
    souvenir**. ⚠️ Deux décisions de conception de la garde écrite en réponse : on asserte le
    SEUIL et non la valeur (épingler « 4,02:1 » se ferait re-baser mécaniquement au premier
    ajustement légitime, donc la garde cesserait de protéger), et le convertisseur OKLCH→sRGB
    est ancré sur des références CONNUES (blanc/noir = 21:1, l'exemple canonique de WCAG
    `#767676` sur blanc = 4,54:1) et non sur les chiffres de l'audit — sinon le test
    vérifierait seulement que je les ai bien recopiés.
33. ⚠⚠ **UN CORRECTIF D'ACCESSIBILITÉ PEUT EN CRÉER UN AUTRE** (18/09, L38). Mes étiquettes
    d'axe faisaient **4,2 px rendus** sur téléphone (mesuré : 30 barres × 18 px de `viewBox`
    compressées dans ~250 px ⇒ échelle 0,46). J'ai corrigé par une largeur fixe + défilement
    horizontal — et ce défilement, non focusable, rendait le graphe inatteignable au clavier
    (WCAG 2.1.1). **Après avoir corrigé un défaut d'accessibilité, demander ce que le remède
    vient d'introduire** ; et un arrêt de tabulation INVISIBLE étant pire qu'un arrêt de trop,
    `tabIndex` vient toujours avec son indicateur de focus.
34. ⚠⚠⚠ **UNE IDEMPOTENCE JUSTE PEUT RENDRE UN CHANTIER ENTIER INERTE** (18/09, trouvé par la
    revue de L38, vérifié dans le code). `empreintePiece(cle, sujet, fileId)` identifie le
    **DOCUMENT**, pas la lecture ; et `lib/pieces/ecrire.ts` fait `dejaPresentes += 1;
    continue;` sur collision, sans aucun `UPDATE` — son en-tête le dit en toutes lettres :
    « une pièce déjà écrite est `dejaPresentes`, jamais dupliquée ni réécrite ». Conséquence :
    les ~2 645 papiers de l'inventaire **ne peuvent pas devenir « lus »** par le chemin
    d'écriture actuel — DriveAI peut ouvrir le document, appeler un modèle, PAYER l'appel et
    poster la pièce, la ligne reste intacte. **L'argent part, rien ne change.** ⚠️ Le défaut
    n'est PAS l'idempotence : refuser un double POST est juste. Ce qui manque est la
    distinction entre « la même pièce repostée » (à refuser) et « la même pièce ENRICHIE par
    une vraie lecture » (à accepter). ⚠️ Et la leçon de conduite : **avant d'écrire une boucle
    qui DÉPENSE, vérifier que son écriture produit un CHANGEMENT** — une boucle inerte qui
    facture est la forme la plus coûteuse de `CORRECTIF-VERT-EN-TEST-INERTE-EN-PROD`. C'est le
    tableau de bord de L38 qui a rendu ça visible, le jour même où il a été écrit.

35. ⚠️ **La garde des couleurs lit `app/manifest.ts` COMMENTAIRES COMPRIS** (18/09/2026,
    lot PWA). J'ai cité le code hexadécimal de l'aplat de l'icône dans un commentaire, pour
    expliquer pourquoi la variante maskable a le même contenu que l'icône normale — et
    `tests/couleurs.test.ts` a rougi : il exige que TOUT `#rrggbb` de ce fichier suive le fond
    du thème, et il lit la source brute. La garde avait raison, mon commentaire était le
    défaut : ce fichier ne doit porter aucune teinte libre, et une phrase qui en cite une la
    porte. Corrigé côté commentaire, jamais côté garde — l'affaiblir pour accommoder de la
    prose aurait rouvert exactement ce qu'elle protège. La teinte se MESURE dans le PNG, elle
    n'a pas besoin d'être recopiée dans du code.
    ⚠️ Corollaire de méthode, payé deux fois dans le même lot : mon script d'édition a ensuite
    numéroté cette leçon en lisant « 100 déploiements/jour » comme un numéro. Une numérotation
    s'ancre sur la FORME complète (`^\d+\. \*\*`), pas sur « la ligne commence par un
    chiffre » — et un script qui lève APRÈS avoir écrit certains fichiers laisse un commit qui
    affirme du faux : c'est arrivé, le message annonçait cette leçon avant qu'elle existe.

36. ⚠️⚠️ **UNE VALEUR QUE J'AI MESURÉE SUR MA BRANCHE DEVIENT FAUSSE AU REBASAGE, ET RIEN NE LE
    DIT** (18/09, lot PWA). J'ai écrit `id: "/moi"` dans `app/manifest.ts` après avoir mesuré
    `start_url` — qui valait bien `/moi` quand la branche est partie. L26b l'a ensuite fait
    dériver de `SECTIONS[0]`, donc `/`. Mon rebasage a pris le code de L26b sans toucher à ma
    valeur : le manifeste SERVI en production annonçait `id: "/moi"` et `start_url: "/"`, et le
    commentaire d'à côté affirmait « ici `/moi`, pas `/` » — le contraire du fichier, trois
    lignes plus bas.
    ⚠️ **Ce que git ne peut pas voir.** Aucun conflit : les deux lignes sont distinctes, la
    fusion est correcte au sens du texte. Ce qui casse est une RELATION entre deux lignes, et
    un fusionneur de texte n'en connaît aucune. **Après un rebasage, re-mesurer toute valeur
    que la branche avait DÉRIVÉE d'un autre fichier** — pas relire son diff, qui est juste.
    ⚠️ **Et la garde a certifié la valeur fausse** : elle vérifiait `id` NON VIDE. Un `id`
    non vide restait vrai, donc verte. Une assertion d'EXISTENCE ne protège jamais une valeur ;
    c'est la même famille que la leçon n° 23, sur une garde qui épingle ce qui ne discrimine pas.
    Trouvé en lisant le manifeste SERVI par la production après le merge, pas en relisant le
    code — corollaire direct de « une réparation n'est finie qu'avec la mesure de son effet ».

37. ⚠⚠ **UNE ALARME SE RE-MESURE AUTANT QU'UN DÉFAUT, ET C'EST ELLE QUI DIMENSIONNE LE LOT**
    (18/09, L39). Le ticket portait les deux : un défaut — « une pièce déjà en base n'est
    jamais réécrite, donc lire un document connu est un NO-OP » — vérifié dans le code et
    EXACT ; et une alarme — « la recherche ne porte donc que sur 83 papiers sur 2 728, une
    colonne `recherche` nulle ne matche rien » — **fausse**. La migration n'ÉCRIT pas
    `recherche`, mais `validerPiece` la **DÉRIVE** du type et de l'émetteur, qu'elle pose :
    mesuré en base, un inventaire porte `recherche = "bail gestion exemple 2026"`. Les papiers
    étaient donc trouvables par leur **étiquette**, jamais par leur **contenu** — manque réel,
    beaucoup plus étroit que « 97 % de la mémoire ». **Un raisonnement sur un champ ABSENT
    doit demander QUI D'AUTRE LE REMPLIT avant de conclure** : un défaut décrit un mécanisme
    qu'on a lu, une alarme décrit une population qu'on a déduite.
38. ⚠⚠ **UN CORRECTIF PEUT RENDRE ATTEIGNABLE UNE BRANCHE MORTE — ICI, HEUREUSEMENT** (18/09,
    L39). Rendre une pièce `statut: "remplacee"` fait exister pour la première fois une ligne
    non `active`, donc active enfin le filtre `vivante()` de `depotLecture` et le
    `sortDeLaPiece` → `retenue` de `lecture.ts` — deux gardes écrites avant tout producteur.
    Elles étaient JUSTES, et sans elles remplacer aurait **doublé chaque papier** dans la
    recherche de Marc : le remède aurait coûté plus que le défaut. D'où la garde qui cherche
    le papier et exige **UNE** réponse, pas deux, avec son anti-vacuité (la requête doit
    trouver l'inventaire AVANT le remplacement, sinon « une seule réponse » est vrai parce que
    la recherche ne matche rien). **Après avoir donné un producteur à un champ, grep ce qui
    FILTRAIT déjà dessus** : ces lecteurs viennent de changer de comportement sans être
    touchés par le diff.
39. ⚠⚠ **UN COMPTEUR QUI NE SORT PAS DE LA FONCTION LAISSE L'APPELANT AVEUGLE** (18/09, L39).
    `acceptees: 1` vaut autant pour « 40 papiers neufs ajoutés » que pour « 40 papiers déjà
    connus enrichis ». DriveAI paie un appel de modèle par document : sans `remplacees` dans
    la RÉPONSE HTTP — pas seulement dans le résultat interne — une boucle qui dépense sans
    rien changer reste indistinguable d'une boucle qui travaille, soit le défaut même que ce
    lot corrige, recommis un cran plus haut. **Quand on corrige une écriture inerte, se
    demander comment son APPELANT saura qu'elle ne l'est plus.**
40. ⚠️ **UN HEREDOC N'EST PAS UN OUTIL D'ÉDITION POUR CE DÉPÔT** (18/09, L39, 3ᵉ fois en deux
    lots). PowerShell n'a aucune redirection heredoc (`python - <<'EOF'` → « Spécification de
    fichier manquante »), et par le shell POSIX un gros volume d'apostrophes françaises casse
    l'analyse (« unexpected EOF »). `$TMPDIR` est vide ici, donc un script se pose dans le
    scratchpad par son chemin ABSOLU, ou le fichier s'écrit avec l'outil Write. Trois
    allées-retours perdus sur un geste qui n'a rien à voir avec le problème.

Propres à ce dépôt, transposées de ce que DriveAI a payé (brief §10) :

5. **La file « à valider » est le vrai risque du projet, pas la sécurité.** Un garde « dans le
   doute, en revue » a déjà neutralisé l'auto-rangement de DriveAI. Ici, la version du piège
   est une mémoire vide parce que rien n'est jamais validé : un fait `propose` issu d'un
   document classé est servi, étiqueté, avant validation ; la file est mesurée (alerte > 100,
   forte > 500) ; et on ne paie pas le rattrapage du stock avant la preuve que Marc valide.
   ⚠️ **Le risque s'est réalisé le 16/09, et pas là où cette ligne l'attendait** : ce n'est pas
   « rien n'est validé » mais « il y a trop à valider ». La première passe de l'inventaire
   DriveAI a posé 2 725 faits dans la file, sur ~4 240 à venir (chiffre re-mesuré, voir §1) — et aucun ne mérite un œil ni
   même une question, puisqu'ils disent tous « ce document existe, il est là ». Le remède n'est
   pas de valider plus vite (ADR 0003) : c'est de **ne pas mettre dans la file ce qu'aucun
   modèle n'a touché**, sinon les faits DÉDUITS — les seuls qui méritent Marc — y sont
   ensevelis. La question utile n'est donc pas « combien reste-t-il à valider ? » mais
   « combien de ce qui reste a été DÉDUIT ? ».
6. **Un test qui mocke la fonction qu'il teste ne voit pas son bug.** Rendre les propriétés
   structurelles quand c'est possible : une fonction qui ne sait pas créer ne créera jamais.
7. **La version du vocabulaire fait partie de l'état qui commande la décision.** Stockée sur
   le fait ET sur le refus — sinon un prédicat refusé aujourd'hui l'est à vie.
8. **Un compteur AGRÉGÉ désigné comme signal a besoin d'un test qui rougit quand un lot change
   ce qu'il agrège.** Payé deux fois, à deux heures d'intervalle (17/09) : `aValider` est mort
   quand le canal DriveAI s'est mis à écrire directement en `valide`, et son remplaçant
   (`document.existe`) est mort quand le lot 17 a migré ces faits en papiers sans les retirer
   des compteurs — figé à 2 729 pendant 28 h, la doc disant de le surveiller. `estServable`
   filtrait les migrés ; la garde manquait là où on COMPTE. **Rien ne rougit jamais, parce
   qu'un compteur rend toujours un nombre** (`tests/comptesMigres.test.ts`, 3 mutations).
41. ⚠⚠ **UN ÉCRAN ÉCRIT POUR UN SEUL GESTE NE RÉPOND À AUCUNE AUTRE QUESTION** (21/09, L40).
    `/pieces` avait été bâti pour RETIRER un papier parti par erreur, et son en-tête le disait
    en toutes lettres : « ce que cette page n'affiche pas : le CONTENU des pièces ». Elle
    montrait donc six colonnes techniques — domaine, niveau, date, `moteur-inventaire-v1`,
    « ouvrir ↗ », « Retirer ». Marc : « pour l'instant ça sert à rien je comprends rien ».
    Le type et l'émetteur étaient en base depuis le premier jour ; la couche de lecture les
    jetait. **Quatrième fois que la réponse est « la capacité existe, le FIL manque »** (le
    filtre de `depotLecture`, `source_ref`, la correction d'un fait, ceci).
    ⚠️ Le nom de l'EXTRACTEUR portait à lui seul l'information la plus importante de l'écran
    — « ce papier n'a jamais été ouvert », vrai de **2 645 lignes sur 2 728** — sous une forme
    que personne ne peut lire. Un identifiant technique affiché tel quel n'informe pas : il
    OCCUPE la place de ce qui informerait.
    ⚠️ Et le garde-fou de l'ancienne page était JUSTE, il visait juste autre chose : cent
    papiers affichés, c'est cent résumés en clair dans le HTML à chaque chargement. D'où la
    séparation — la LISTE ne déchiffre que les facettes (`rendreFacettesPiece`), le CONTENU
    s'ouvre papier par papier. **Un garde-fou qui gêne ne se retire pas : on cherche ce qu'il
    protège réellement, et on le garde en déplaçant le reste.**
    ⚠️ La garde des surfaces à compteurs (leçon n° 20) a ROUGI sur cette page neuve, comme
    sur `/depenses` trois jours plus tôt : deux fois sur deux, une liste DÉRIVÉE du code a vu
    ce que la relecture n'avait pas vu.

42. ⚠⚠⚠ **UN TEST QUI TOURNE SUR UN AUTRE PILOTE QUE LA PRODUCTION VALIDE UN CONTRAT QU'ELLE
    N'A PAS** (21/09, mesuré DANS le pilote). Le remplacement d'une pièce (ADR 0008, mergé le
    matin même) enveloppait ses deux écritures dans `db.transaction`. Vert sur 821 tests, et
    **HTTP 500** au premier appel réel : `drizzle-orm/neon-http` lève `No transactions support
    in neon-http driver` (`session.js`, lu, pas déduit) — la production tourne sur ce pilote,
    les tests sur PGlite, qui les supporte. Conséquence en chaîne : DriveAI a suspendu son
    canal après UN document, et la campagne de lecture de Marc est restée à l'arrêt pendant
    qu'il demandait « ça ne m'explique toujours pas l'avancement ».
    ⚠️ **C'est EXACTEMENT la panne des migrations du 16/09**, un étage plus haut : là, PGlite
    acceptait le multi-commandes que Neon refuse ; ici, il accepte les transactions que Neon
    refuse. Deux fois, la même forme — **le harnais de test est plus PERMISSIF que la
    production**, donc ce qui casse est invisible par construction. La parade n'est pas
    « tester avec la vraie base » (impossible ici) mais de **scanner la SOURCE** : la garde
    (`tests/pilotePostgres.test.ts`) lit `lib/db/index.ts` pour prouver quel pilote sert, lit
    le message d'erreur DANS `node_modules` pour prouver que la limite existe encore, puis
    refuse tout `.transaction(` dans `lib/` et `app/`. Sans ses deux cas d'anti-vacuité, elle
    passerait le jour où le pilote changerait de nom ou lèverait la limite.
    ⚠️ **`db.batch` existe sur neon-http et ferait l'affaire — il a été ÉCARTÉ** : PGlite ne
    l'a pas, donc aucun test ne pourrait l'exercer, et on échangerait un piège contre l'autre.
    L'écriture se fait en SÉQUENCE, dans l'ordre où chaque coupure laisse un état que la passe
    suivante RATTRAPE. L'ordre inverse est le seul qui ne se rattrape pas, et il est gardé.
    ⚠️ Corollaire de conduite, quatrième fois cette semaine : **la cause n'a été atteignable
    qu'une fois la précédente réparée.** Le motif était persisté depuis toujours dans
    `DriveAI_PIECE_DERNIER_REFUS` et lu par PERSONNE — c'est le lot d'observabilité de la
    veille qui a fait apparaître « canal coupé : HTTP 500 (pièces) ». Un diagnostic qu'aucune
    surface n'affiche n'existe pas.


9. **Un défaut de configuration n'est pas une décision.** Si `perimetres` renvoie « tout »
   pour un jeton inconnu, la base est ouverte. Échec fermé, et le cas est testé.

26. ⚠️⚠️ **Un ADR qui a opposé DEUX critères a peut-être laissé une TROISIÈME question non
    posée** (21/09/2026, ADR 0008). L'ADR 0006 §2 refusait « la meilleure confiance gagne »
    (un modèle s'auto-évalue) et « la plus récente gagne » (une re-lecture ratée écraserait
    une bonne extraction) — les deux à raison. Il en concluait qu'une vraie lecture n'en
    remplace jamais une autre, donc qu'un papier garde à vie l'extraction du prompt en
    vigueur ce jour-là. Or les deux critères écartés répondent à des questions que la machine
    ne sait pas trancher (*qui est le meilleur ?*, *qui est le dernier ?*) ; il en restait une
    qu'elle sait trancher — ***qui l'a DEMANDÉ ?***. ⚠️ Devant une décision verrouillée qui
    semble interdire ce qu'on veut faire, relire **les options qu'elle a comparées** avant sa
    conclusion : une conclusion juste sur un ensemble d'options incomplet reste incomplète.
    ⚠️ Et l'amendement doit refermer les portes que l'original craignait, pas les contourner :
    la lignée ne lit ni confiance ni date, et l'ancienne ligne est GARDÉE — donc l'écrasement
    silencieux redouté n'existe pas, puisqu'on peut comparer.
27. ⚠️ **Une permission POSÉE n'est pas une permission DEMANDÉE.** Si DriveAI annonçait
    lui-même « remplace celle-ci », le garde reposerait sur le bon vouloir de l'appelant —
    exactement ce que l'ADR 0006 refusait. `LIGNEE_EXTRACTEURS` vit donc ICI et jamais dans le
    lot reçu : un producteur qui s'étiquette « v9 » sans que ce nom y figure ne remplace rien.
    ⚠️ La friction (bumper le nom dans DEUX dépôts) EST le garde-fou, pas un inconvénient :
    une relecture coûte un appel de modèle par document, la rendre facile la rendrait
    involontaire. ⚠️ Et il faut dire ce que l'amendement NE rattrape pas — le passeport qui l'a
    déclenché ne se relit pas utilement, son OCR ne porte rien : c'est la PHOTO qu'il faut
    refaire. Un correctif annoncé plus large qu'il n'est fait chercher au mauvais endroit.

43. ⚠️⚠️ **DEUX COMPTEURS QUI SE RESSEMBLENT, ET L'ÉCRAN MET EN AVANT CELUI QUI NE PEUT PAS
    BOUGER** (21/09/2026, L41). Marc : « j'ai toujours seulement 100 faits validés, pourquoi ? ».
    Mesuré : 100 faits validés (dernier le 19/09), **2 748 papiers**, et une campagne de lecture
    qui tournait très bien — 71 papiers lus au dernier tick. Les deux chiffres étaient JUSTES ;
    ce qui était faux, c'est que la carte du hub et l'écran Régler mettaient en avant le SEUL
    des deux que le travail en cours ne touche pas. La lecture d'un papier écrit une PIÈCE, pas
    un FAIT : le compteur qu'il regardait était **structurellement incapable de monter**, et
    aucune surface ne le disait.
    ⚠️ La question à poser devant « pourquoi ça ne bouge pas » n'est donc pas « qu'est-ce qui
    est cassé ? » mais **« ce chiffre est-il celui que le travail en cours fait monter ? »** —
    et si la réponse est non, le défaut est dans le CHOIX de la métrique, pas dans le moteur.
    ⚠️ **Le remède n'est PAS de retirer le compteur** (mon premier réflexe, et Marc l'a corrigé
    dans la phrase suivante) : c'est d'en publier un qui répond vraiment à sa question — « le
    nombre d'info que l'app a sur moi EN TOUT ». D'où `lib/totalInformations.ts`, PUR, source
    UNIQUE consommée par l'écran ET par le hub : deux additions écrites séparément seraient une
    règle et demie, et l'écart ne se verrait jamais.
    ⚠️ **Sommer deux unités différentes n'est honnête qu'à une condition** : un fait (une phrase
    que Marc a confirmée) et un papier (un document dont on sait qu'il existe) ne sont pas la
    même chose, donc **la décomposition s'affiche PARTOUT où le total s'affiche** — sur la carte,
    ce sont les deux métriques publiées juste en dessous ; à l'écran, la ligne sous le nombre. Un
    total seul redeviendrait le compteur trompeur qu'on vient de retirer, dans l'autre sens. La
    garde qui le tient est une RELATION (`total === faits + papiers`, sur les valeurs
    RÉELLEMENT publiées), jamais un libellé épinglé — qui se re-baserait au prochain poste.
    ⚠️ Et un poste NON MESURÉ fait disparaître le total entier : la somme des postes lisibles
    afficherait un nombre trop petit sous l'étiquette « en tout », c'est-à-dire un cumul amputé
    qui se présente comme une mesure.
