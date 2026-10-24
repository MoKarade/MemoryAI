// lib/apprentissage.ts — la passe qui fait APPRENDRE la mémoire, et qui DIT pourquoi elle s'arrête.
//
// Jusqu'au 16/09, tout le mécanisme existait et rien ne l'appelait : les conversations étaient
// gardées (lot 8), l'extracteur écrit et testé (lot 9), la page de questions livrée (lot 7) —
// mais l'extraction était un BOUTON et aucun producteur n'alimentait les questions. Mesuré ce
// jour-là : le seed avait posé 98 faits le 15/09, il y en avait 105 le lendemain. Sept en
// vingt-quatre heures. Marc : « je veux aussi que l'IA commence à apprendre ».
//
// ══ CE QUE CETTE PASSE FAIT, ET CE QU'ELLE NE FAIT PAS ═══════════════════════════════════
//
// Elle extrait des faits des conversations non encore lues, puis elle produit des QUESTIONS
// sur ce que la mémoire ne sait pas. Elle ne valide rien : un fait extrait reste `propose`
// (l'ADR 0003 n'auto-valide que le MÉCANIQUE, et une lecture de modèle n'est pas mécanique).
//
// ⚠️ ELLE DIT TOUJOURS POURQUOI ELLE S'ARRÊTE. C'est la leçon que DriveAI a payée le matin
// même : son étape d'envoi vers la Mémoire sortait sur son garde-temps sans écrire une ligne,
// et « rien à faire », « jamais atteinte » et « budget épuisé » avaient le même symptôme — le
// silence. Une seule fonction compose le résultat, et chaque sortie porte son motif.
//
// ⚠️ LE BUDGET EST CELUI DE L'APPRENTISSAGE, jamais celui du chat (`lib/coutChat.ts`). Une
// passe qui dévore la journée ne doit pas fermer la bouche de Marc.

import type { Cle } from "./chiffrement";
import { budgetOuvert, jourQuebec, type IdModele } from "./coutChat";
import type { ClientModele } from "./chat/agent";
import type { Conversation } from "./db/schema";
import type { DepotConversations } from "./conversations/depot";
import { extraireDUneConversation, PlafondApprentissageError } from "./conversations/extraction";
import type { DepotAdmin } from "./depotAdmin";
import type { DepotFaits } from "./depotFaits";
import type { DepotQuestions } from "./depotQuestions";
import { produireDesQuestions } from "./questions/producteur";
import { poserContradictions, type ResultatContradictions } from "./questions/poserContradictions";
import { comblerLesTrous, type ResultatComblement } from "./questions/combler";
import type { FaitEnConflit } from "./questions/contradictions";
import { passeRelecture, type DepotRelecture, type ResultatRelecture } from "./relectureLia";

/**
 * Combien de messages non extraits valent une passe. ⚠️ Ce n'est pas un réglage de confort :
 * à 1, chaque tour de chat déclencherait un appel LLM et le budget partirait en une soirée ;
 * trop haut, Marc dit quelque chose d'important et la mémoire ne le voit que le lendemain.
 * Quatre = deux échanges, soit le moment où une conversation a dit quelque chose.
 */
export const SEUIL_MESSAGES_NON_EXTRAITS = 4;

/** Au plus tant de conversations par passe : une borne DURE, en plus du budget. */
export const MAX_CONVERSATIONS_PAR_PASSE = 10;

/**
 * Pourquoi la passe s'est arrêtée. `rien-a-faire` et `budget` ne sont PAS la même chose et
 * n'appellent pas le même geste — les confondre est exactement la panne du 16/09.
 */
export const FINS_PASSE = [
  "termine",
  "budget",
  "rien-a-faire",
  "cle-absente",
  "base-absente",
  "gel",
] as const;
export type FinPasse = (typeof FINS_PASSE)[number];

export const MOTIFS_FIN_PASSE: Record<FinPasse, string> = {
  termine: "tout ce qui attendait a été lu",
  budget: "budget d'apprentissage du jour épuisé — reprise demain",
  "rien-a-faire": "aucune conversation neuve à lire",
  "cle-absente": "⚠️ ANTHROPIC_API_KEY absente — l'apprentissage est éteint, pas en panne",
  "base-absente": "⚠️ base injoignable",
  gel: "⚠️ mémoire gelée (MEMORYAI_GEL) — rien n'est lu ni écrit",
};

export interface ResultatPasse {
  conversations: number;
  faitsProposes: number;
  questionsPosees: number;
  coutUsd: number;
  fin: FinPasse;
  /**
   * Ce que la détection de contradictions a trouvé. ⚠️ Publié SÉPARÉMENT de `questionsPosees`
   * : « trois divergences détectées, zéro posée parce que la file est pleine » et « aucune
   * divergence » donnent le même zéro dans le compteur agrégé, et ce sont deux états qui
   * n'appellent pas le même geste. Absent quand la détection n'a pas pu tourner.
   */
  contradictions?: ResultatContradictions;
  /**
   * Les trous du vocabulaire (prédicats sans fait validé) et ce que la passe en a demandé.
   * ⚠️ Publié à part, pour la même raison : « douze trous, zéro posé parce que la file est
   * pleine » et « aucun trou » donnent le même zéro dans `questionsPosees`.
   */
  comblement?: ResultatComblement;
  /** Ce que la relecture de LIA a validé ou laissé à Marc (ADR 0025). Absent : elle n'a pas tourné. */
  relecture?: ResultatRelecture;
}

/** Une passe qui n'a rien fait, avec son motif. Jamais un objet vide et muet. */
export function passeVide(fin: FinPasse): ResultatPasse {
  return { conversations: 0, faitsProposes: 0, questionsPosees: 0, coutUsd: 0, fin };
}

/**
 * PURE — les conversations qui méritent une passe, les plus RÉCENTES d'abord.
 *
 * `extraiteJusqua` est un RANG : une conversation qui continue redevient extractible, et c'est
 * ce qui rend l'appel après un tour de chat sûr (on ne relit jamais ce qui l'a déjà été).
 * ⚠️ Récentes d'abord, et c'est un choix : ce que Marc vient de dire compte plus que ce qu'il
 * disait la semaine dernière. Le vieux finit par passer quand le neuf se tarit — mais si la
 * file ne se vidait jamais, ce serait un plateau silencieux (leçon « pagination mouvante »),
 * et c'est ce que le compteur `conversations` de la passe rend visible.
 */
export function meriteUnePasse(
  c: Pick<Conversation, "supprimeLe" | "nbMessages" | "extraiteJusqua">,
  seuil: number = SEUIL_MESSAGES_NON_EXTRAITS,
): boolean {
  return c.supprimeLe === null && c.nbMessages - (c.extraiteJusqua ?? 0) >= seuil;
}

/** Idem, sur une liste — la même règle, jamais recopiée. */
export function conversationsAExtraire(
  toutes: readonly Conversation[],
  seuil: number = SEUIL_MESSAGES_NON_EXTRAITS,
  max: number = MAX_CONVERSATIONS_PAR_PASSE,
): Conversation[] {
  return toutes
    .filter((c) => meriteUnePasse(c, seuil))
    .sort((a, b) => b.finLe.getTime() - a.finLe.getTime())
    .slice(0, max);
}

export interface ContextePasse {
  client: ClientModele;
  modele: IdModele;
  cle: Cle;
  conversations: DepotConversations;
  ecriture: DepotFaits;
  admin: DepotAdmin;
  questions: DepotQuestions;
  maintenant: () => Date;
  /** Combien de faits VALIDÉS porte chaque prédicat — le producteur de questions ne voit que ça. */
  comptesParPredicat: () => Promise<Record<string, number>>;
  /**
   * Les faits vivants et DÉCHIFFRÉS candidats à une contradiction (`valide` et `propose`).
   *
   * ⚠️ Le déchiffrement est chez l'APPELANT, pas ici : ce module ne porte pas la clé, comme
   * `comptesParPredicat` ne porte pas la base. Et la détection qui suit est PURE, donc
   * gratuite — voir pourquoi ça change où elle se branche, ci-dessous.
   */
  faitsEnConflit: () => Promise<readonly FaitEnConflit[]>;
  /**
   * Poser les questions qui comblent les trous du vocabulaire (L28). Allumé par défaut : c'est
   * gratuit (aucun appel de modèle) et il ne remplit que les places que les contradictions
   * laissent libres. `false` n'existe que pour les tests qui portent sur le producteur par modèle.
   */
  comblerLesTrous?: boolean;
  /**
   * La relecture de LIA (ADR 0025) : elle valide seule ce que deux signaux confirment. Absente,
   * elle ne tourne pas ; elle passe en DERNIER, pour ne jamais prendre le budget de l'extraction.
   */
  relecture?: DepotRelecture;
}

/**
 * Une passe complète : extraire, puis demander. L'ordre compte — les questions se posent sur
 * ce qui MANQUE encore, donc après avoir ajouté ce qu'on pouvait ajouter.
 */
export async function passeApprentissage(ctx: ContextePasse): Promise<ResultatPasse> {
  const jour = jourQuebec(ctx.maintenant());
  const res: ResultatPasse = { conversations: 0, faitsProposes: 0, questionsPosees: 0, coutUsd: 0, fin: "termine" };

  // Le budget se relit à CHAQUE tour : une extraction coûteuse peut fermer la porte au milieu
  // de la passe, et continuer aveuglément dépenserait au-delà du plafond que Marc a fixé.
  // ⚠️ Le plafond se lit à CHAQUE tour, comme la dépense : Marc peut le baisser pendant qu'un
  // import tourne (c'est tout l'objet de [L34]), et une passe qui l'aurait lu une seule fois
  // au démarrage continuerait de dépenser sur un plafond qu'il vient de fermer.
  const budgetReste = async () =>
    budgetOuvert(await ctx.admin.depenseDuJourUsd(jour, "apprentissage"), "apprentissage", await ctx.admin.plafonds());
  if (!(await budgetReste())) return passeVide("budget");

  const candidates = conversationsAExtraire(await ctx.conversations.liste(200));
  if (candidates.length === 0) {
    res.fin = "rien-a-faire";
  } else {
    for (const c of candidates) {
      if (!(await budgetReste())) {
        res.fin = "budget";
        break;
      }
      const messages = await ctx.conversations.messages(c.id, ctx.cle);
      try {
        const r = await extraireDUneConversation({
          client: ctx.client,
          modele: ctx.modele,
          conversationId: c.id,
          messages,
          cle: ctx.cle,
          ecriture: ctx.ecriture,
          admin: ctx.admin,
          maintenant: ctx.maintenant,
        });
        res.conversations++;
        res.faitsProposes += r.lot.acceptes;
        res.coutUsd += r.coutUsd;
        await ctx.conversations.marquerExtraite(c.id, c.nbMessages);
      } catch (err) {
        // Le plafond n'est pas une panne : c'est la fin normale d'une passe.
        if (err instanceof PlafondApprentissageError) {
          res.fin = "budget";
          break;
        }
        // ⚠️ Une conversation qui échoue ne fait PAS tomber les suivantes, et elle n'est PAS
        // marquée extraite : elle sera reprise. Un échec par item ne partage jamais le
        // drapeau d'arrêt de la boucle (leçon DriveAI).
        console.error("[apprentissage] extraction impossible", c.id, err);
      }
    }
  }

  // ⚠️ LES CONTRADICTIONS D'ABORD, ET HORS DU GARDE-BUDGET. Elles se composent à partir de
  // l'état de la base, sans aucun appel de modèle : elles ne coûtent RIEN. Les mettre derrière
  // le même garde que les questions de modèle ferait attendre le lendemain à une divergence
  // sur une date de bail, pour une raison budgétaire qui ne la concerne pas. Et elles passent
  // en PREMIER parce que le plafond de cinq ouvertes est partagé : un choix que Marc peut
  // trancher d'un clic vaut mieux qu'une question ouverte sur un prédicat vide.
  try {
    const c = await poserContradictions({
      faits: await ctx.faitsEnConflit(),
      questions: ctx.questions,
      maintenant: ctx.maintenant,
    });
    res.questionsPosees += c.posees;
    res.contradictions = c;
    if (res.fin === "rien-a-faire" && c.posees > 0) res.fin = "termine";
  } catch (err) {
    // Jamais bloquant : une détection qui échoue ne doit pas empêcher l'extraction de tourner.
    console.error("[apprentissage] contradictions impossibles", err);
  }

  // ⚠️ PUIS LES TROUS, TOUJOURS HORS DU GARDE-BUDGET et AVANT le producteur par modèle : ils
  // sont gratuits, ils suivent l'ordre de Marc (santé, famille, goûts d'abord) et ils ne posent
  // que dans les places libres. Le producteur par modèle ne reçoit donc que ce qui reste — il
  // ne tourne plus à vide quand la file est déjà pleine de questions qui ne coûtent rien.
  if (ctx.comblerLesTrous !== false) {
    try {
      const t = await comblerLesTrous({
        comptes: await ctx.comptesParPredicat(),
        questions: ctx.questions,
        maintenant: ctx.maintenant,
      });
      res.questionsPosees += t.posees;
      res.comblement = t;
      if (res.fin === "rien-a-faire" && t.posees > 0) res.fin = "termine";
    } catch (err) {
      // Jamais bloquant, comme les contradictions : une lecture qui échoue ne doit pas empêcher
      // le producteur par modèle de tourner.
      console.error("[apprentissage] trous impossibles", err);
    }
  }

  // Les questions, si le budget tient encore. Elles ne dépendent d'AUCUNE extraction : même
  // une passe « rien-a-faire » doit pouvoir demander ce qui manque depuis des semaines.
  if (await budgetReste()) {
    try {
      const q = await produireDesQuestions({
        client: ctx.client,
        modele: ctx.modele,
        admin: ctx.admin,
        questions: ctx.questions,
        comptesParPredicat: await ctx.comptesParPredicat(),
        maintenant: ctx.maintenant,
      });
      res.questionsPosees += q.posees;
      res.coutUsd += q.coutUsd;
      if (res.fin === "rien-a-faire" && q.posees > 0) res.fin = "termine";
    } catch (err) {
      if (err instanceof PlafondApprentissageError) res.fin = "budget";
      else console.error("[apprentissage] questions impossibles", err);
    }
  } else if (res.fin === "termine") {
    res.fin = "budget";
  }

  if (ctx.relecture) {
    try {
      const r = await passeRelecture({ client: ctx.client, cle: ctx.cle, depot: ctx.relecture, admin: ctx.admin, maintenant: ctx.maintenant });
      res.relecture = r;
      res.coutUsd += r.coutUsd;
      if (res.fin === "rien-a-faire" && r.relus > 0) res.fin = "termine";
    } catch (err) {
      // Jamais bloquant : ce qui précède est déjà écrit, et la relecture reprendra à la passe suivante.
      console.error("[apprentissage] relecture impossible", err);
    }
  }

  return res;
}

/**
 * Le déclencheur RÉACTIF : après un tour de chat, on lit CETTE conversation et rien d'autre.
 *
 * ⚠️ Surtout pas `passeApprentissage` ici. Une passe complète lit jusqu'à dix conversations et
 * produit des questions : la lancer à chaque tour de chat coûterait le budget d'une journée en
 * une soirée, et ferait attendre Marc pour un travail qui ne le concerne pas. Le cron quotidien
 * est là pour le reste.
 *
 * Rend `null` quand il n'y a rien à faire — un appelant ne doit pas pouvoir confondre « pas
 * assez de neuf » avec « ça a tourné et n'a rien trouvé ».
 */
export async function apprendreDeLaConversation(params: {
  client: ClientModele;
  modele: IdModele;
  conversationId: string;
  cle: Cle;
  conversations: DepotConversations;
  ecriture: DepotFaits;
  admin: DepotAdmin;
  maintenant: () => Date;
}): Promise<{ faitsProposes: number; coutUsd: number } | null> {
  const c = await params.conversations.parId(params.conversationId);
  if (c === null || !meriteUnePasse(c)) return null;

  const jour = jourQuebec(params.maintenant());
  if (!budgetOuvert(await params.admin.depenseDuJourUsd(jour, "apprentissage"), "apprentissage", await params.admin.plafonds()))
    return null;

  const messages = await params.conversations.messages(c.id, params.cle);
  if (messages.length === 0) return null;

  const r = await extraireDUneConversation({
    client: params.client,
    modele: params.modele,
    conversationId: c.id,
    messages,
    cle: params.cle,
    ecriture: params.ecriture,
    admin: params.admin,
    maintenant: params.maintenant,
  });
  // Marquée APRÈS : une passe qui échoue laisse la conversation extractible.
  await params.conversations.marquerExtraite(c.id, c.nbMessages);
  return { faitsProposes: r.lot.acceptes, coutUsd: r.coutUsd };
}
