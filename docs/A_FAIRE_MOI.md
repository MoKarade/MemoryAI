# À FAIRE — Marc

> Ce que **seul Marc** peut faire, parce qu'aucune session Claude ne peut créer un secret,
> déployer un Apps Script, ni écrire dans un compte Vercel ou GitHub.
>
> ⚠️ **Chaque entrée dit ce qui est DÉBLOQUÉ et ce qui reste éteint sans elle.** Une liste de
> corvées sans conséquence écrite ne se fait pas — et une tâche routée ici sans son effet est
> une tâche que personne ne saura prioriser.
>
> Convention commune aux huit dépôts : ce fichier existe pour que Claude ait un endroit où
> ROUTER ce qu'il ne peut pas faire, au lieu de le répéter en chat à chaque session.

---

## 1. Les deux secrets du réveil continu (GitHub) — 2 min

**Ce que ça débloque** : la mémoire apprend **toutes les 3 h** au lieu d'une fois par jour.
Les divergences entre sources (question en QCM) sont détectées à chaque réveil, gratuitement.

**Pourquoi GitHub et pas Vercel** : le compte Vercel est au plan `hobby`, qui plafonne les
crons à **un par jour** (mesuré le 17/09). L'augmenter veut dire payer.

**Où** : `github.com/MoKarade/MemoryAI` → **Settings** → **Secrets and variables** → **Actions**
→ *New repository secret*.

| Nom du secret | Valeur |
|---|---|
| `MEMORYAI_URL` | `https://memoryai.hubperso.com` |
| `CRON_SECRET` | **exactement** la même valeur que la variable `CRON_SECRET` du projet Vercel `memory-ai` |

Pour relire la valeur côté Vercel : *Vercel → memory-ai → Settings → Environment Variables →
`CRON_SECRET` → l'œil pour révéler*. Ne la retape pas de mémoire : une valeur approchante donne
un `401`, que le workflow signale sans rougir — donc tu ne le verrais pas passer.

**Vérifier que c'est bon, sans attendre 3 h** : onglet **Actions** → *Apprentissage continu* →
**Run workflow**. Le journal affiche le code HTTP et le corps de la réponse :

- `HTTP 200` + un motif (`tout ce qui attendait a été lu`, `aucune conversation neuve à lire`,
  `budget d'apprentissage du jour épuisé`) ⇒ **c'est branché**, même si la passe n'a rien fait ;
- un avertissement « le CRON_SECRET du dépôt ne correspond pas à celui de Vercel » ⇒ `401`, la
  valeur est fausse ;
- un avertissement « CRON_SECRET absent côté Vercel » ⇒ `503`, il manque dans Vercel, pas ici ;
- « Éteint : MEMORYAI_URL ou CRON_SECRET absent des secrets du dépôt » ⇒ les secrets ne sont pas
  posés (et le workflow sort **en vert**, c'est voulu : un planificateur qui rougit tous les
  jours pour une intégration pas branchée, on apprend à l'ignorer).

⚠️ Sans ces deux secrets, **rien ne casse** : le cron Vercel quotidien continue de tourner. Tu
perds seulement la fréquence.

---

## 2. Le hook Claude Code — le plus gros levier, ~10 min

**Ce que ça débloque** : **toutes** tes sessions Claude Code alimentent la mémoire, sur tous tes
projets. Aujourd'hui aucune ne le fait — mesuré le 17/09, il n'y a aucun hook `Stop` dans
`~/.claude/settings.json`. C'est là que tu passes tes journées, et rien n'en sort.

### a) Le jeton (Vercel)

*Vercel → memory-ai → Settings → Environment Variables → Add*, pour **Production** :

- **Nom** : `MEMORYAI_TOKEN_CLAUDECODE_ECRITURE`
- **Valeur** : une chaîne aléatoire, par exemple avec `openssl rand -base64 24`, ou n'importe
  quel générateur de mot de passe. ⚠️ **Jamais une phrase choisie** : c'est une porte d'écriture.

⚠️ **Puis REDÉPLOYER.** Vercel fige les variables au déploiement : une variable posée sans
redéploiement n'existe pas pour ce qui est servi. Vécu le 15/09 (`AUTH_SECRET`, vingt minutes de
`503`). Un `git commit --allow-empty` poussé sur `main`, ou *Deployments → … → Redeploy*.

### b) L'essayer à blanc d'abord

Dans un terminal, depuis un clone à jour de MemoryAI (`npm ci` fait) :

```bash
export MEMORYAI_URL="https://memoryai.hubperso.com"
export MEMORYAI_TOKEN_CLAUDECODE_ECRITURE="…la valeur du point a…"
node scripts/pousser-session.mjs ~/.claude/projects/<un-projet>/<une-session>.jsonl --dry-run
```

`--dry-run` **n'envoie rien** : il affiche combien de messages partiraient et combien de blocs
d'outils sont ignorés. Retire `--dry-run` quand le compte te paraît juste.

### c) Le hook

Il vit dans `~/.claude/settings.json` — **hors de ce dépôt**, parce que tu veux toutes tes
sessions et pas seulement celles de MemoryAI. Ajoute (ou fusionne) :

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:\\chemin\\vers\\MemoryAI\\scripts\\pousser-session.mjs\" \"$CLAUDE_TRANSCRIPT_PATH\"",
            "env": {
              "MEMORYAI_URL": "https://memoryai.hubperso.com",
              "MEMORYAI_TOKEN_CLAUDECODE_ECRITURE": "…la valeur du point a…"
            }
          }
        ]
      }
    ]
  }
}
```

⚠️ **Le chemin est celui de TON clone**, et il peut être inhabituel : le dépôt MemoryAI peut être cloné
DANS `CarAI/docs/MemoryAI`. Si tu le déplaces un jour, ce hook casse en silence — c'est la
première chose à vérifier si la mémoire cesse de se remplir.

⚠️ **Ce qui ne part JAMAIS, et c'est tenu par deux barrières** : le script ne retient que les
blocs `type: "text"`, donc les diffs, les fichiers lus et les sorties de commandes ne quittent
pas ta machine ; et le serveur **refuse** (`resultat_outil_interdit`) un corps qui en porterait
un, même imbriqué. Un scan de secrets tourne en plus, côté serveur, avant le chiffrement.

⚠️ **Le risque reste entier et il est nommé** : ce scan est une **heuristique**. Personne ne
relit avant l'envoi — c'est la conséquence de ton choix de l'automatique (ADR 0002 §4,
question C). Pour voir ce qui est parti : `/conversations`.

---

## 3. Le flux vivant des pièces (DriveAI) — ta décision, pas une corvée

**Ce que ça débloque** : chaque document que DriveAI classe envoie son CONTENU à la mémoire, en
continu, au lieu du seul rattrapage armé sur `04` et `01`.

**Où** : `src/Config.gs` de DriveAI, `PIECE_PUSH: false` → `true`, puis déploiement Apps Script.

⚠️ **À ne pas faire avant d'avoir regardé `/pieces`.** `traiterDocument_` a **huit** appelants,
dont les campagnes de masse : l'allumer re-tarife aussi ce qui tourne déjà. C'est pour ça que
c'est livré éteint.

⚠️ **Et ce n'est PAS ce qui débloque la mesure du socle.** Les 77 pièces arrivées viennent des
domaines `04 · Immigration` et `01 · Administratif & identité`, que l'ADR 0001 §5.3 classe
niveau 3 : seuls leur domaine et leurs dates sont servis, jamais leur contenu. Les questions de
test du socle (numéro de police, téléphone du propriétaire, papiers de Banque Aurore) ont besoin
d'un domaine à contenu servi — `02 · Finances`, `03 · Logement & véhicule` ou `05 · Carrière`.
C'est `PREFIXES_DOMAINE_DECISIF_PIECE` qui le décide, côté DriveAI.

---

## 4. Lire la CSP et les en-têtes servis — 1 min, quand tu y penses

Aucune session Claude ne peut joindre `memoryai.hubperso.com` : le proxy refuse au CONNECT
(mesuré deux fois). Ce qui est vérifiable d'ici : qu'un déploiement de production ait été créé
et soit `READY` sur le bon SHA. Ce qui ne l'est pas : la réponse réellement servie.

Donc si une intégration se met à échouer sans rien de rouge côté CI, la première chose à
regarder est **la réponse dans ton navigateur** (onglet Réseau, en-têtes) — et les **journaux
runtime Vercel**, qui nomment la cause en une ligne. Deux pannes de mise en service ont été
tranchées comme ça le 15/09, sans toucher au code.
