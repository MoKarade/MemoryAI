# ADR 0032 — LIA agit seule dans les limites du catalogue, et tient le journal de ce qu'elle a fait

- **Statut** : **proposé** (26/10/2026, fil MemoryAI). Il applique la décision de Marc du 26/10 à
  14:46Z (« l'indépendance ») et sa carte de 14:50Z (« Agit aussi dans les apps »). Tâche : MemoryAI#283,
  mission .github#575. **Le code attend l'OK de Marc sur CE texte** (même patron que les ADR 0030 et 0031).
- **Amont** : ADR 0025 (LIA valide seule ce que deux signaux confirment), 0023 (faits déduits), 0027 (idées
  de LIA), 0031 (sorties des apps), et le catalogue d'outils et de niveaux de risque (tâche MemoryAI 282,
  `lib/lia/catalogueOutils.ts`), dont cet ADR est le premier consommateur.

## Contexte

Aujourd'hui LIA ne fait rien sans qu'on la sollicite, sauf ce qui tourne déjà dans la passe quotidienne
de l'apprentissage (`app/api/cron/apprentissage/route.ts`) : relecture et validation, déduction, idées,
purge des sorties. Chacune de ces étapes a sa règle et son ADR, mais **rien ne dit à Marc, au même endroit,
ce que LIA a fait seule, ni pourquoi, ni ne lui donne un frein d'un geste**. Demander « l'indépendance »,
c'est demander ces trois choses : agir, le dire, pouvoir l'arrêter.

## Décision

1. **Qui choisit : des règles, pas un modèle.** Le choix de l'action du jour est une fonction PURE
   (`lib/lia/autonomie.ts`) qui lit des COMPTES (faits à relire, déductions possibles, demandes du hub,
   sorties arrivées) et rend une liste d'actions du catalogue, chacune avec sa raison en une phrase fixe.
   Aucun appel de modèle pour décider : 0 $ de plus, résultat testable, même entrée = même choix.
   Un planificateur par modèle reste possible plus tard ; il aurait son propre ADR et son propre poste.
2. **Ce qu'elle peut faire seule : les niveaux `lecture` et `ecriture-interne` du catalogue, rien d'autre.**
   Une action dont le niveau est `sort-de-memoryai` n'est JAMAIS lancée par la passe : elle reste un
   geste de Marc. Toute action doit figurer au catalogue ; une action sans niveau fait échouer le test,
   comme un outil sans niveau fait échouer le chat.
3. **Les limites qui restent** (décision de Marc) : rien de supprimé, rien d'envoyé hors du projet, rien
   qui touche l'argent ni un secret, jamais le niveau 3 (ADR 0011). Ces quatre lignes sont des tests.
4. **Le journal « ce que j'ai fait seule »** : une table `actions_lia` (migration additive 0037), une
   ligne par action tentée : le jour de Québec, l'instant, l'action (clé fermée), son niveau, sa raison
   (200 caractères au plus, texte fixe produit par la règle), un NOMBRE d'éléments touchés, et l'issue
   (`faite`, `echec`, `frein`, `budget`). **Aucune valeur de fait, aucun contenu** : des comptes et des
   clés, comme `GET /api/etat`. Rétention : 90 jours. Il s'affiche dans « Sa journée ».
5. **Le frein** : un interrupteur en base, une ligne, basculé d'un geste dans Régler. Il se lit **avant
   chaque action**, pas seulement au début de la passe : posé au milieu, la suivante est notée `frein` et
   ne part pas. Posé, il arrête aussi les passes déjà existantes qui relèvent de l'autonomie (relecture,
   déduction, idées), pas seulement la nouvelle. `MEMORYAI_GEL=1` reste l'arrêt dur et passe avant lui.
   Valeur par défaut : **en marche** (les étapes tournent déjà aujourd'hui) [À vérifier avec Marc].
6. **Le budget** : aucun poste neuf. Chaque action garde le poste qu'elle a (`apprentissage`, `chat`) et
   le plafond DUR de `lib/coutChat.ts` ; le total de 3 $/jour ne change pas et n'est donc pas dépassable
   par construction. Une action qui n'a plus de budget est notée `budget` et saute. Si un planificateur
   par modèle arrive, son poste se prend sur `apprentissage` et la somme reste 3 (test existant).
7. **Quand** : dans la passe quotidienne qui existe, pas de nouveau cron (le plan gratuit de Vercel limite
   le nombre de crons [À vérifier]) ; jamais à la minute 0.
8. **Les gestes pour une app** (« Agit aussi dans les apps ») : LIA dépose une INTENTION réversible dans
   la boîte d'intentions (tâche MemoryAI 285), jamais un geste dans l'app elle-même. Elle attend cette
   boîte et les jetons d'écrivain par app (tâche MemoryAI 281).

## Lots

1. Cet ADR (docs seules). 2. `lib/lia/autonomie.ts` pur + migration 0037 + tests. 3. La passe écrit son
journal, le frein, l'affichage dans « Sa journée ». 4. Les intentions d'app, après la tâche 285.

## Ce qui reste ouvert

- **Règles ou modèle pour choisir** : cet ADR recommande les règles (0 $, testable). Un modèle choisirait
  mieux dans les cas flous mais coûterait un poste et rendrait le journal moins prévisible.
- **Frein par défaut** : en marche (recommandé, rien ne change pour ce qui tourne déjà) ou en pause (rien
  ne part tant que Marc n'a pas levé le frein une première fois).
- [À vérifier] la limite de crons du plan Vercel au moment du code ; la rétention de 90 jours du journal.
