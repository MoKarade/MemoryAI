// lib/mcp/outils.ts — ce que claude.ai peut DEMANDER à MemoryAI : les cinq outils `memoryai_*`
// (ADR 0001 Q14). Le catalogue est le contrat public : un outil ajouté = une ligne ici ET une
// décision écrite.
//
// ══ TROIS RÈGLES QUI GOUVERNENT CE FICHIER ═══════════════════════════════════════════
//
// 1. UN FAIT SORT EN RÉSULTAT D'OUTIL, BALISÉ, JAMAIS AUTREMENT (`lib/mcp/balisage.ts`).
//    Aucun outil ne rend un fait sans passer par `rendreServables` (statuts, canari, N2) puis
//    `baliserFaits`. Verrouillé par `tests/mcp.test.ts`, prouvé par mutation.
// 2. CHAQUE APPEL EST JOURNALISÉ AVANT DE RÉPONDRE (`lib/journalAcces.ts`) — c'est le
//    protocole qui s'en charge, pas chaque outil : un outil qui oublierait n'existe pas.
// 3. LES SEULES ÉCRITURES SONT `memoryai_proposer` (un fait, par `ecrireLot` : mêmes gardes
//    que `POST /api/faits`, statut `propose`, fiabilité `app`, jamais `valide`) et
//    `memoryai_demander` (une QUESTION à Marc, par `validerQuestion` — ADR 0002 §5.1 ; elle
//    ne dit rien sur lui, elle dit ce qu'on ignore, et elle ne devient un fait que s'il
//    répond). Aucun outil ne valide, ne rejette, n'oublie ni ne purge : ces gestes sont ceux
//    de Marc, dans l'UI.

import type { DepotFaits } from "../depotFaits";
import type { DepotLecture } from "../depotLecture";
import type { DepotQuestions } from "../depotQuestions";
import type { DepotConversations } from "../conversations/depot";
import { validerEntree } from "../conversations/entree";
import { MAX_OUVERTES, validerQuestion, type OrigineQuestion } from "../questions";
import { ecrireLot, LOT_MAX } from "../ecrireFaits";
import type { Ecrivain } from "../jetons";
import type { Cle } from "../chiffrement";
import { empreinte } from "../chiffrement";
import { chercherParmi, lecteurPeutN3, n2Autorise, n3Autorise, niveauMaxServi, rendreServables, STATUTS_SERVIS, type FaitLisible, type PolitiqueLecture } from "../lecture";
import type { FaitServi, PieceServie } from "../chat/liens";
import { domaines as domainesDuVocabulaire, VERSION_COURANTE, vocabulaire } from "../vocabulaire";
import { baliserFaits, baliserPieces, ENTETE_DONNEES, lienPrincipal } from "./balisage";
import type { DepotPiecesLecture } from "../pieces/depotLecture";
import { noteFamilles } from "../pieces/familles";
import { niveauServi, rendreServablesPieces } from "../pieces/lecture";
import { pieceCorrespond } from "../pieces/rechercheEnMemoire";
import { cleFacette, FAMILLES_FACETTE, type FamilleFacette } from "../pieces/facettes";
import { dechiffrer, DechiffrementError } from "../chiffrement";
import { BANC_COURANT, type DepotBanc } from "../banc/passe";

export interface ContexteOutils {
  lecture: DepotLecture;
  ecriture: DepotFaits;
  /**
   * Les PIÈCES, en LECTURE SEULE — et c'est le TYPE qui le tient, comme pour les
   * conversations. Aucun outil ne peut écrire une pièce : elles viennent de DriveAI, par
   * `POST /api/pieces`, jamais d'un modèle qui converse.
   */
  pieces: DepotPiecesLecture;
  /** La file de questions (ADR 0002 §5.1). Requis : le compilateur énumère les appelants. */
  questions: DepotQuestions;
  /**
   * Les conversations (ADR 0002 §5.2), en ÉCRITURE SEULE — et c'est le TYPE qui le tient, pas
   * une consigne. `messages()` n'est pas dans ce Pick : un outil qui voudrait rendre le
   * contenu d'une conversation ne compilerait pas.
   *
   * ⚠️ Pourquoi cette restriction plutôt qu'une règle écrite. L'ADR interdit de SERVIR une
   * conversation à une app, pas d'en écrire une — claude.ai est l'une des trois sources. La
   * frontière passe donc entre lire et écrire, exactement ici : `demarrer` et `consigner`
   * écrivent, `parId` ne rend que des métadonnées (jamais un message), et `messages` reste
   * hors de portée. `tests/conversations.test.ts` le prouve par mutation.
   */
  conversations: Pick<DepotConversations, "demarrer" | "consigner" | "parId">;
  /**
   * Le banc de questions de la refonte LIA (MemoryAI#69), en LECTURE de nombres seulement.
   * Facultatif : absent, `memoryai_etat` dit « non branché » (`null`), jamais un zéro.
   */
  banc?: Pick<DepotBanc, "derniereMesure" | "comptesParCapacite">;
  cle: Cle;
  env: Record<string, string | undefined>;
  /** `claude-ai` pour le MCP ; `chat` pour le chat plein écran (lot 5). */
  lecteur: string;
  maintenant: () => Date;
}

export interface ResultatOutil {
  texte: string;
  usage: "conversation" | "action";
  /**
   * Les faits SERVIS pendant cet appel — `id`, `valeur`, `statut`.
   *
   * ⚠️ REMPLACE `idsFaits`, il ne s'y ajoute pas. Le post-traitement de [L25]
   * (`lib/chat/liens.ts`) a besoin des VALEURS pour relier ce qui apparaît dans la réponse ;
   * les identifiants du journal s'en dérivent par `.map((f) => f.id)`. Deux champs qui
   * répondent à la même question finissent par diverger — un appelant met l'un à jour et
   * oublie l'autre, et le lecteur suit le périmé. Un seul champ, dérivé une fois.
   */
  faitsServis: FaitServi[];
  /**
   * Les PAPIERS servis (ADR 0011, 24/09). Facultatif parce que seul un outil en sert : son
   * absence vaut « aucun papier », c'est-à-dire le côté qui SIGNALE une citation de papier
   * comme non sourcée — jamais celui qui la laisse passer.
   */
  piecesServies?: PieceServie[];
  niveauMaxServi: number;
  questionEmpreinte: string | null;
}

export interface Outil {
  name: `memoryai_${string}`;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  executer(args: Record<string, unknown>, ctx: ContexteOutils): Promise<ResultatOutil>;
}

/** L'écrivain derrière `memoryai_proposer` : une app, jamais Marc — c'est lui qui validera. */
export const ECRIVAIN_CLAUDE_AI: Ecrivain = { appId: "claude-ai", role: "ecriture", fiabilites: ["app"] };

/** La fenêtre SQL de toute lecture d'outil. Exportée pour que `tests/evictionMigres.test.ts`
 *  DIMENSIONNE sa fixture dessus au lieu de recopier 500 — un test qui épingle un nombre
 *  cesse de discriminer le jour où la constante bouge, sans rien rougir. */
export const LIMITE_LECTURE_BASE = 500;
const LIMITE_DEFAUT = 60;
const LIMITE_MAX = 100;

function bool(v: unknown, defaut: boolean): boolean {
  return typeof v === "boolean" ? v : defaut;
}
function entier(v: unknown, defaut: number, max: number): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? Math.min(v, max) : defaut;
}
function liste(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 30) : undefined;
}

function politique(args: Record<string, unknown>, ctx: ContexteOutils): PolitiqueLecture {
  return {
    inclureN2: bool(args.inclure_n2, false),
    n2Autorise: n2Autorise(ctx.env),
    // ⚠️ ADR 0011 : le lecteur est vérifié ICI, le seul point par lequel chaque outil construit
    // sa politique. Un lecteur hors de `LECTEURS_N3` n'obtient pas N3, quoi que le modèle
    // appelant demande — et `n3Autorise` ne suffit plus à l'ouvrir.
    inclureN3: lecteurPeutN3(ctx.lecteur) && bool(args.inclure_n3, false),
    n3Autorise: n3Autorise(ctx.env),
    inclureProposes: bool(args.inclure_proposes, true),
  };
}

const avisN2 = (p: PolitiqueLecture): string =>
  p.inclureN2 && !p.n2Autorise
    ? "Note : les faits de niveau 2 (domicile, santé, relations, famille, finances) ont été demandés mais MEMORYAI_N2_CHAT n'est pas posée : ils ne sont pas servis."
    : "";

/** ⚠️ Symétrique d'`avisN2`, et pour la même raison : une demande SILENCIEUSEMENT refusée fait
 *  conclure « la Mémoire ne le sait pas » là où la réponse est « elle le sait et ne le dit pas ».
 *  Les deux avis se cumulent — refuser N3 n'implique rien sur N2. */
const avisN3 = (p: PolitiqueLecture, args: Record<string, unknown>, ctx: ContexteOutils): string => {
  // ⚠️ ADR 0011 : un lecteur hors liste qui DEMANDE N3 l'apprend — sinon il conclurait que la
  // Mémoire ne sait rien, là où elle sait et ne le dit qu'à Marc, dans son chat.
  if (!lecteurPeutN3(ctx.lecteur) && args.inclure_n3 === true) return NOTE_N3_HORS_CHAT;
  return p.inclureN3 && !p.n3Autorise
    ? "Note : le contenu des papiers d'identité (niveau 3) a été demandé mais MEMORYAI_N3_CHAT n'est pas posée : ces papiers restent en sommaire."
    : "";
};

/** ADR 0011 — ce qu'un lecteur hors du chat apprend, au lieu d'un silence. */
export const NOTE_N3_HORS_CHAT =
  "Note : le contenu des papiers d'identité (niveau 3) ne se lit que dans le chat de MemoryAI, par Marc (ADR 0011) : ici, ces papiers restent en sommaire.";

async function lireEtFiltrer(args: Record<string, unknown>, ctx: ContexteOutils) {
  const p = politique(args, ctx);
  const rows = await ctx.lecture.faits({
    statuts: p.inclureProposes ? STATUTS_SERVIS : ["valide"],
    domaines: liste(args.domaines),
    limite: LIMITE_LECTURE_BASE,
  });
  // ⚠️ LA QUARANTAINE MORD ICI, sur le chemin qui va vers un MODÈLE (ADR 0004 §2.3). Un
  // prédicat neuf — donc possiblement fabriqué par un document piégé — n'atteint jamais
  // claude.ai tant que Marc ne l'a pas accepté ou que trois extracteurs distincts ne l'ont
  // pas proposé. C'est le seul endroit du dépôt où ce verrou est CONSULTÉ pour les outils.
  const retenus = await ctx.lecture.predicatsRetenus();
  const rendu = rendreServables(rows, p, ctx.cle, retenus);
  // ⚠️ `rendu.retenus` ÉTAIT DÉTRUIT ICI, et `rendreServables` le calcule exprès. Son propre
  // commentaire dit pourquoi : « « aucun fait » et « des faits, mais leur prédicat attend »
  // ne disent pas la même chose, et seul le second désigne un geste (aller les accepter) ».
  // Un compteur qui existe et que personne ne lit n'est pas une protection
  // (`UN-INVENTAIRE-N-EST-UNE-PROTECTION-QUE-POUR-QUI-LE-LIT`).
  return { p, faits: rendu.faits, illisibles: rendu.illisibles, retenus: rendu.retenus };
}

/** Ce que le modèle doit savoir des faits ÉCARTÉS — sinon « aucun fait » est ambigu. */
export function noteEcartes(illisibles: number, enQuarantaine: number): string {
  const bouts: string[] = [];
  if (illisibles > 0) bouts.push(`${illisibles} fait(s) illisibles ont été écartés.`);
  if (enQuarantaine > 0) {
    bouts.push(
      `${enQuarantaine} fait(s) ne sont pas servis parce que leur prédicat attend d'être accepté par Marc (quarantaine du vocabulaire) — dis-le-lui plutôt que de conclure que la mémoire ne sait rien.`,
    );
  }
  return bouts.join(" ");
}

const resultat = (
  texte: string,
  faits: readonly FaitLisible[],
  p: PolitiqueLecture,
  questionEmpreinte: string | null = null,
): ResultatOutil => ({
  texte,
  usage: "conversation",
  // ⚠️ L'ÉTIQUETTE, pas la valeur. Un fait `ref_document` porte un fileId opaque en
  // valeur et son libellé humain dans `attributs.type` — c'est le libellé que le modèle
  // écrit, donc le seul appariement qui puisse tirer (Marc, 18/09 : « j'ai pas les liens
  // pour les documents »). Le repli sur `valeur` couvre tous les faits ordinaires.
  faitsServis: faits.map((f) => ({
    id: f.id,
    etiquette: typeof f.attributs?.type === "string" && f.attributs.type ? f.attributs.type : f.valeur,
    statut: f.statut,
    lien: f.lien,
  })),
  niveauMaxServi: faits.reduce((m, f) => Math.max(m, f.niveau), 0) || niveauMaxServi(p),
  questionEmpreinte,
});

/**
 * L'origine d'une question vient du LECTEUR, jamais du corps — comme la fiabilité d'un fait
 * vient du jeton. Un lecteur inconnu compte comme `claude-ai` : c'est la voie machine, donc
 * la plus prudente des deux (le chat, lui, est Marc devant son écran).
 */
export function origineDuLecteur(lecteur: string): OrigineQuestion {
  return lecteur === "chat" ? "chat" : "claude-ai";
}

export const OUTILS: readonly Outil[] = [
  {
    name: "memoryai_contexte",
    description:
      "Les faits que MemoryAI connaît sur Marc, balisés, les validés d'abord. Filtrable par domaine (emploi, logement, vehicule, gout, document, fiscal…). Niveau 2 (domicile, santé, relations, famille, finances) seulement si inclure_n2 est vrai — ce choix est journalisé.",
    inputSchema: {
      type: "object",
      properties: {
        domaines: { type: "array", items: { type: "string" }, description: "Domaines du vocabulaire à servir ; vide = tous." },
        inclure_n2: { type: "boolean", description: "Servir aussi les faits de niveau 2 pour CET appel (journalisé)." },
        inclure_n3: { type: "boolean", description: "Servir aussi le CONTENU des papiers d'identité (niveau 3) pour CET appel (journalisé)." },
        inclure_proposes: { type: "boolean", description: "Servir aussi les faits pas encore validés par Marc (défaut vrai, étiquetés propose)." },
        limite: { type: "integer", description: `Nombre maximal de faits (défaut ${LIMITE_DEFAUT}, max ${LIMITE_MAX}).` },
      },
    },
    async executer(args, ctx) {
      const { p, faits, illisibles, retenus } = await lireEtFiltrer(args, ctx);
      const tries = [...faits].sort((a, b) => (a.statut === b.statut ? 0 : a.statut === "valide" ? -1 : 1));
      const servis = tries.slice(0, entier(args.limite, LIMITE_DEFAUT, LIMITE_MAX));
      const notes = [avisN2(p), avisN3(p, args, ctx), noteEcartes(illisibles, retenus)].filter(Boolean).join(" ");
      return resultat(baliserFaits(servis, notes || undefined), servis, p);
    },
  },
  {
    name: "memoryai_chercher",
    description:
      "Cherche dans la mémoire de Marc à partir d'une question en français (« où est mon avis de cotisation 2024 », « quand finit mon bail »). Rend les faits pertinents, balisés, avec leur provenance et, pour un document, son lien Drive.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "La question, ou des mots-clés." },
        domaines: { type: "array", items: { type: "string" } },
        inclure_n2: { type: "boolean" },
        inclure_n3: { type: "boolean" },
        limite: { type: "integer", description: "Nombre maximal de résultats (défaut 20)." },
      },
      required: ["question"],
    },
    async executer(args, ctx) {
      const question = typeof args.question === "string" ? args.question.slice(0, 500) : "";
      if (!question.trim()) throw new Error("Paramètre `question` requis.");
      const { p, faits, illisibles, retenus } = await lireEtFiltrer(args, ctx);
      const trouves = chercherParmi(faits, question, entier(args.limite, 20, LIMITE_MAX));
      const notes = [
        trouves.length === 0 ? "Aucun fait ne correspond. Il n'est peut-être pas encore dans la mémoire : memoryai_inventaire dit ce qu'elle sait tenir." : "",
        avisN2(p),
        avisN3(p, args, ctx),
        noteEcartes(illisibles, retenus),
      ]
        .filter(Boolean)
        .join(" ");
      return resultat(baliserFaits(trouves, notes || undefined), trouves, p, empreinte(ctx.cle, "question", question));
    },
  },
  {
    name: "memoryai_proposer",
    description:
      "Propose UN fait à la mémoire de Marc (il devra le valider dans /a-valider). Le prédicat doit appartenir au vocabulaire (memoryai_inventaire). Jamais un montant, jamais une position, jamais un numéro d'identité, jamais un texte de niveau 3.",
    inputSchema: {
      type: "object",
      properties: {
        predicat: { type: "string", description: "Ex. vehicule.bail.fin, gout.cuisine, document.existe." },
        valeur: { type: "string", description: "≤ 200 caractères ; une date AAAA-MM-JJ ; ou un identifiant de document Drive." },
        valeur_type: { type: "string", enum: ["texte", "date", "ref_document"] },
        valide_de: { type: "string", description: "AAAA-MM-JJ, optionnel." },
        valide_a: { type: "string", description: "AAAA-MM-JJ, optionnel." },
        attributs: {
          type: "object",
          description: "Pour un document : type, emetteur, annee (AAAA), echeance (AAAA-MM-JJ).",
          properties: { type: { type: "string" }, emetteur: { type: "string" }, annee: { type: "string" }, echeance: { type: "string" } },
        },
      },
      required: ["predicat", "valeur", "valeur_type"],
    },
    async executer(args, ctx) {
      const jour = ctx.maintenant().toISOString().slice(0, 10);
      const entree: Record<string, unknown> = {
        sujet: "marc",
        predicat: args.predicat,
        valeur: args.valeur,
        valeur_type: args.valeur_type,
        provenance: { source_type: "app", source_ref: `claude-ai:${jour}`, extracteur: "memoryai_proposer-v1", date_source: jour },
      };
      for (const k of ["valide_de", "valide_a", "attributs"] as const) if (args[k] !== undefined) entree[k] = args[k];
      const r = await ecrireLot([entree], ECRIVAIN_CLAUDE_AI, ctx.cle, ctx.ecriture);
      const texte =
        r.acceptes === 1
          ? "Fait proposé. Marc le verra dans « à valider » ; il ne sera servi comme validé qu'après son OK."
          : r.dejaPresents === 1
            ? "Ce fait est déjà proposé ou connu : rien n'a été réécrit."
            : `Refusé : ${r.refuses[0]?.code ?? "?"} — ${r.refuses[0]?.raison ?? ""}`;
      return { texte, usage: "action", faitsServis: [], niveauMaxServi: 0, questionEmpreinte: null };
    },
  },
  {
    name: "memoryai_demander",
    description:
      "Pose UNE question à Marc quand la mémoire ne sait pas, ou qu'un fait mérite une précision. Elle apparaît dans /questions ; sa réponse devient un fait validé. Au plus " +
      `${MAX_OUVERTES}` +
      " questions ouvertes à la fois : poser au-delà écarte la plus ancienne. Ne pose que ce qui produirait un fait du vocabulaire (memoryai_inventaire), et dis POURQUOI tu la poses.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "≤ 200 caractères, une vraie question (avec un point d'interrogation). Ex. « Quand ton bail de logement se renouvelle-t-il ? »",
        },
        predicat_vise: { type: "string", description: "Le prédicat que la réponse alimenterait. Ex. logement.bail.fin." },
        motif: {
          type: "string",
          description: "≤ 200 caractères : pourquoi tu la poses, en langage courant. Une question sans motif ne se répond pas.",
        },
      },
      required: ["question", "predicat_vise", "motif"],
    },
    async executer(args, ctx) {
      const v = validerQuestion(
        { question: args.question, predicat_vise: args.predicat_vise, motif: args.motif },
        origineDuLecteur(ctx.lecteur),
      );
      if (!v.ok) {
        return { texte: `Question refusée : ${v.code} — ${v.raison}`, usage: "action", faitsServis: [], niveauMaxServi: 0, questionEmpreinte: null };
      }
      const r = await ctx.questions.poser(v, ctx.maintenant());
      const texte =
        r.etat === "deja-posee"
          ? "Cette question a déjà été posée à Marc : elle ne se repose pas."
          : r.ecartees.length > 0
            ? `Question posée. La file était pleine (${MAX_OUVERTES}) : ${r.ecartees.length} question(s) plus ancienne(s) ont été écartées.`
            : "Question posée. Marc la verra dans /questions ; sa réponse deviendra un fait validé.";
      return { texte, usage: "action", faitsServis: [], niveauMaxServi: 0, questionEmpreinte: null };
    },
  },
  {
    name: "memoryai_consigner",
    description:
      "Garde cet échange dans la mémoire de Marc, chiffré. À appeler quand un échange contient quelque chose de durable sur lui, pour qu'il ne se perde pas avec la conversation. N'envoie QUE des messages : jamais un résultat d'outil, jamais un diff, jamais le contenu d'un fichier lu. Rends l'identifiant reçu au prochain appel pour continuer la même conversation.",
    inputSchema: {
      type: "object",
      properties: {
        messages: {
          type: "array",
          description: "Les messages de l'échange, dans l'ordre.",
          items: {
            type: "object",
            properties: {
              role: { type: "string", enum: ["user", "assistant"] },
              contenu: { type: "string", description: "Le texte du message, tel qu'il a été écrit." },
            },
            required: ["role", "contenu"],
          },
        },
        conversation_id: { type: "string", description: "Pour continuer une conversation déjà commencée. Optionnel." },
      },
      required: ["messages"],
    },
    async executer(args, ctx) {
      // La source est IMPOSÉE par l'appelant, jamais lue dans les arguments : c'est le MCP
      // qui parle, donc `claude-ai`. Le corps ne peut pas se faire passer pour Claude Code.
      const v = validerEntree(
        { source: "claude-ai", messages: args.messages ?? [], ...(typeof args.conversation_id === "string" ? { conversation_id: args.conversation_id } : {}) },
        "claude-ai",
      );
      if (!v.ok) {
        return { texte: `Refusé : ${v.code} — ${v.raison}`, usage: "action", faitsServis: [], niveauMaxServi: 0, questionEmpreinte: null };
      }
      const maintenant = ctx.maintenant();
      const existante = v.conversationId !== null ? await ctx.conversations.parId(v.conversationId) : null;
      const id = existante?.id ?? (await ctx.conversations.demarrer("claude-ai", maintenant));
      const r = await ctx.conversations.consigner(id, v.messages, ctx.cle, maintenant);
      const masques = r.secretsRetires > 0 ? ` ${r.secretsRetires} fragment(s) ressemblant à un secret ont été masqués.` : "";
      return {
        texte: `${r.ecrits} message(s) consigné(s), chiffrés.${masques} conversation_id : ${id} — renvoie-le pour continuer la même conversation.`,
        usage: "action",
        faitsServis: [],
        niveauMaxServi: 0,
        questionEmpreinte: null,
      };
    },
  },
  {
    name: "memoryai_etat",
    description:
      "L'état de la mémoire : nombre de faits par statut et par niveau, faits en attente de validation, canaris, dernier fait validé, prédicats refusés, si le niveau 2 peut être servi, et la dernière mesure du banc de questions. Aucun contenu.",
    inputSchema: { type: "object", properties: {} },
    async executer(_args, ctx) {
      const c = await ctx.lecture.comptes();
      const etat = {
        app: "memoryai",
        versionVocabulaire: VERSION_COURANTE,
        parStatut: c.parStatut,
        parNiveau: c.parNiveau,
        aValider: c.parStatut.propose ?? 0,
        canaris: c.canaris,
        dernierFaitValideLe: c.dernierValideLe,
        niveau2Servable: n2Autorise(ctx.env),
        predicatsRefuses: c.refus.slice(0, 20),
        lotMaximal: LOT_MAX,
        banc: await etatBanc(ctx),
      };
      return { texte: JSON.stringify(etat, null, 2), usage: "conversation", faitsServis: [], niveauMaxServi: 0, questionEmpreinte: null };
    },
  },
  {
    name: "memoryai_inventaire",
    description:
      "Le vocabulaire fermé de la mémoire : les domaines et les prédicats qu'elle sait tenir, avec leur niveau, leur type de valeur, et combien de faits chacun porte. À consulter avant memoryai_proposer.",
    inputSchema: {
      type: "object",
      properties: { domaine: { type: "string", description: "Ne rendre qu'un domaine (ex. vehicule)." } },
    },
    async executer(args, ctx) {
      const c = await ctx.lecture.comptes();
      const filtre = typeof args.domaine === "string" ? args.domaine : null;
      const predicats = vocabulaire()
        .filter((p) => !filtre || p.domaine === filtre)
        .map((p) => ({
          predicat: p.predicat,
          niveauMin: p.niveauMin,
          types: p.types,
          multi: p.multi,
          description: p.description,
          nombre: c.parPredicat[p.predicat] ?? 0,
          ...(p.deprecie ? { deprecie: p.deprecie } : {}),
        }));
      const inv = { versionVocabulaire: VERSION_COURANTE, domaines: domainesDuVocabulaire(), predicats };
      return { texte: JSON.stringify(inv, null, 2), usage: "conversation", faitsServis: [], niveauMaxServi: 0, questionEmpreinte: null };
    },
  },
  {
    name: "memoryai_papiers_facettes",
    description:
      "La liste des valeurs CONNUES des papiers de Marc : types de documents, émetteurs, titulaires, avec le NOMBRE de papiers derrière chacune. À appeler AVANT de chercher : sans elle, un émetteur se devine (« Banque Aurore » contre « Banque Aurore Assurances générales ») et la recherche ne rend rien.",
    inputSchema: {
      type: "object",
      properties: {
        famille: { type: "string", enum: [...FAMILLES_FACETTE], description: "type, emetteur ou titulaire (défaut : emetteur)." },
        limite: { type: "integer", description: `Nombre maximal de valeurs (défaut ${LIMITE_DEFAUT}, max ${LIMITE_MAX}).` },
        inclure_n2: { type: "boolean" },
        inclure_n3: { type: "boolean" },
      },
    },
    async executer(args, ctx) {
      const famille: FamilleFacette =
        typeof args.famille === "string" && (FAMILLES_FACETTE as readonly string[]).includes(args.famille)
          ? (args.famille as FamilleFacette)
          : "emetteur";
      // ⚠️ ADR 0011 : une facette déchiffrée est un CONTENU (un titulaire de passeport est un
      // nom), donc elle suit la MÊME politique que la pièce : lecteur, interrupteur, case de la
      // conversation. Revue #71 : la première version ne regardait que le lecteur, et le chat
      // rendait les titulaires N3 interrupteur coupé et case décochée.
      const p = politique(args, ctx);
      const brutes = await ctx.pieces.facettes(famille, entier(args.limite, LIMITE_DEFAUT, LIMITE_MAX), niveauMaxServi(p));
      const c = await ctx.pieces.comptes();

      const lignesTexte: string[] = [];
      let illisibles = 0;
      // Les valeurs DÉCHIFFRÉES, pour détecter les graphies multiples d'un même émetteur. Le
      // regroupement est PUR (`lib/pieces/familles.ts`) et ne touche à rien en base : il ne
      // fait que le DIRE au modèle, qui décide ensuite quelles graphies passer en filtre.
      const valeursLues: { valeur: string; nombre: number }[] = [];
      for (const f of brutes) {
        try {
          // ⚠️ Déchiffré avec l'AAD du REPRÉSENTANT (`id|niveau`), pas de la pièce courante :
          // c'est lui qui a scellé cette valeur. Prendre un autre id ferait échouer le
          // déchiffrement — bruyamment, ce qui est le bon côté.
          const valeur =
            f.representantNiveau === 0
              ? f.valeurChiffree
              : dechiffrer(ctx.cle, f.valeurChiffree, f.representantId, f.representantNiveau);
          lignesTexte.push(`${valeur} — ${f.nombre} papier(s)`);
          valeursLues.push({ valeur, nombre: f.nombre });
        } catch (err) {
          if (err instanceof DechiffrementError) illisibles++;
          else throw err;
        }
      }
      const entete =
        `${c.total} papier(s) au total. Par domaine : ` +
        (Object.entries(c.parDomaine).map(([d, n]) => `${d} (${n})`).join(", ") || "aucun") +
        `. Valeurs connues pour « ${famille} »` +
        (illisibles ? ` — ${illisibles} illisible(s), écartée(s)` : "") +
        " :";
      // ⚠️ La note NE PARAÎT QUE s'il y a vraiment plusieurs graphies. Mesuré sur le corpus
      // de Marc : « Banque Aurore » (56), « Banque Aurore Assurances » (12) et « Banque Aurore
      // Assurances Générales » (7) — donc 75, là où un filtre exact rend 56. Sans cette
      // ligne le modèle ne peut pas le savoir : les émetteurs sont filtrés par clé keyée, et
      // un hash n'a pas de préfixe.
      const note = noteFamilles(valeursLues);
      return {
        texte: [ENTETE_DONNEES, entete, ...(lignesTexte.length ? lignesTexte : ["(aucune)"]), ...(note ? ["", note] : [])].join("\n"),
        usage: "conversation",
        faitsServis: [],
        niveauMaxServi: brutes.reduce((m, f) => Math.max(m, f.representantNiveau), 0),
        questionEmpreinte: null,
      };
    },
  },
  {
    name: "memoryai_papiers_chercher",
    description:
      "Cherche dans les PAPIERS de Marc (ce que les documents contiennent : émetteur, titulaire, dates, numéros de référence, résumé). Filtrable par domaine, année, type, émetteur et titulaire — emploie `memoryai_papiers_facettes` pour connaître les valeurs exactes. Pour un papier d'identité (passeport, permis, carte), chercher par type ou par mots-clés (« passeport »).",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Mots-clés en français. Facultatif si des filtres sont donnés." },
        domaines: { type: "array", items: { type: "string" } },
        annees: { type: "array", items: { type: "integer" } },
        types: { type: "array", items: { type: "string" }, description: "Types de documents, tels que rendus par les facettes." },
        emetteurs: { type: "array", items: { type: "string" }, description: "Émetteurs, tels que rendus par les facettes." },
        titulaires: { type: "array", items: { type: "string" }, description: "Titulaires (la personne que le papier concerne), tels que rendus par les facettes." },
        inclure_n2: { type: "boolean" },
        inclure_n3: { type: "boolean" },
        limite: { type: "integer", description: `Nombre maximal de papiers (défaut ${LIMITE_DEFAUT}, max ${LIMITE_MAX}).` },
      },
    },
    async executer(args, ctx) {
      const p = politique(args, ctx);
      const limite = entier(args.limite, LIMITE_DEFAUT, LIMITE_MAX);
      // ⚠️ Les valeurs de facette arrivent EN CLAIR du modèle et repartent en clés KEYÉES :
      // c'est le seul chemin. Filtrer sur la colonne chiffrée ne marcherait pas (deux pièces
      // portant « Banque Aurore » ont deux chiffrés différents), et déchiffrer toute la table
      // pour comparer reviendrait à la sortir pour la filtrer.
      const cles = (famille: FamilleFacette, v: unknown) =>
        liste(v)?.flatMap((x) => {
          const c = cleFacette(ctx.cle, famille, x);
          return c ? [c] : [];
        });
      const texte = typeof args.question === "string" ? args.question.slice(0, 500) : undefined;
      const titulaireCles = cles("titulaire", args.titulaires);
      const typeCles = cles("type", args.types);
      const emetteurCles = cles("emetteur", args.emetteurs);
      // Un filtre DEMANDÉ compte, même si aucune valeur n'a produit de clé : sinon un nom mal
      // orthographié retomberait sur « pas de filtre » et rendrait les sommaires N3.
      const aFiltreFacette = [args.types, args.emetteurs, args.titulaires].some((v) => (liste(v)?.length ?? 0) > 0);
      // Les filtres, écrits UNE fois pour les trois lectures qui suivent : la liste, son total,
      // et la recherche N3 en mémoire. Trois copies divergeraient au premier filtre ajouté.
      const filtres = {
        domaines: liste(args.domaines),
        annees: Array.isArray(args.annees)
          ? args.annees.filter((a): a is number => Number.isInteger(a))
          : undefined,
        typeCles,
        emetteurCles,
        titulaireCles,
        // ⚠️ ADR 0011 : quand la politique ne sert PAS N3, un filtre de facette (type, émetteur,
        // titulaire) ne doit pas CONFIRMER ce que le sommaire cache. Revue #71, prouvé par
        // sonde : `types: ["passeport"]` rendait au MCP le sommaire du passeport, et « aucune
        // pièce » pour un type absent — un oracle sur le statut migratoire.
        niveaux: aFiltreFacette && niveauMaxServi(p) < 3 ? [0, 1, 2] : undefined,
      };
      const rows = await ctx.pieces.chercher({ ...filtres, texte, limite: LIMITE_LECTURE_BASE });
      const rendu = rendreServablesPieces(rows, p, ctx.cle);
      const { retenues, sommaires } = rendu;
      let { illisibles } = rendu;
      let pieces = rendu.pieces;
      // ⚠️ LE TOTAL, et pas le nombre de lignes rendues. Sans lui, un lecteur devant une liste
      // pleine ne peut qu'INVENTER une borne basse — mesuré le 17/09 : « au moins 214 papiers »
      // puis « au moins 68 Banque Aurore », quand il y en a 2 723 et 75. Le modèle n'avait pas
      // menti, l'outil ne lui disait rien. La troncature est à deux étages (la tranche servie,
      // et `LIMITE_LECTURE_BASE` en base), donc compter les lignes rendues ne corrigerait que
      // le premier.
      let correspondent = await ctx.pieces.compter({ ...filtres, texte });

      // ── ADR 0011 §2.4 : le plein texte des papiers N3, EN MÉMOIRE ────────────────────
      // Un papier N3 n'a pas de colonne `recherche` (régime chiffré) : `to_tsvector` ne le voit
      // jamais, et « mon passeport » ne rendait rien alors que le passeport est là. Seulement
      // quand cette politique SERT le niveau 3 — donc jamais au MCP —, on déchiffre les papiers
      // N3 que les autres filtres désignent et on compare ici. Rien n'est écrit en clair.
      let n3Tronque = false;
      if (texte?.trim() && niveauMaxServi(p) === 3) {
        const n3 = await ctx.pieces.chercher({ ...filtres, niveaux: [3], limite: LIMITE_LECTURE_BASE });
        n3Tronque = n3.length === LIMITE_LECTURE_BASE;
        const r3 = rendreServablesPieces(n3, p, ctx.cle);
        illisibles += r3.illisibles;
        const deja = new Set(pieces.map((x) => x.id));
        const trouves = r3.pieces.filter((x) => !deja.has(x.id) && pieceCorrespond(x, texte));
        // En TÊTE : c'est ce que la question désignait, et c'est ce que le plein texte ne
        // pouvait pas voir. Les mettre après une liste pleine les ferait tomber de la tranche.
        pieces = [...trouves, ...pieces];
        correspondent += trouves.length;
      }
      const servies = pieces.slice(0, limite);
      // ⚠️ Ce qui ne sort pas se DIT. « aucun papier » et « des papiers, mais leur niveau ne
      // sort pas ici » appellent des gestes opposés, et le silence les confond.
      const notes = [
        // Dit SEULEMENT quand il y a vraiment plus que ce qui est montré : une phrase qui
        // apparaît à chaque réponse, y compris quand tout est là, devient du décor.
        correspondent > servies.length
          ? `${correspondent} papier(s) correspondent, ${servies.length} montrés ici — affine par domaine, année, type, émetteur ou titulaire plutôt que d'estimer le reste.`
          : "",
        n3Tronque
          ? `La recherche dans les papiers d'identité n'a lu que les ${LIMITE_LECTURE_BASE} premiers — ajoute un filtre (domaine, année, type) pour qu'elle les voie tous.`
          : "",
        retenues ? `${retenues} papier(s) de niveau 2 non servis ici — relance avec inclure_n2 si Marc l'autorise.` : "",
        sommaires
          ? `${sommaires} papier(s) d'identité servis en SOMMAIRE (domaine, année, dates) — leur contenu existe et n'est pas servi ici ; ` +
            (lecteurPeutN3(ctx.lecteur) ? "relance avec inclure_n3 si Marc l'autorise." : "il ne se lit que dans le chat de MemoryAI.")
          : "",
        illisibles ? `${illisibles} papier(s) illisibles ont été écartés.` : "",
        avisN2(p),
        avisN3(p, args, ctx),
      ].filter(Boolean).join(" ");
      return {
        texte: baliserPieces(servies, notes || undefined),
        usage: "conversation",
        faitsServis: [],
        // Exactement les papiers BALISÉS dans ce retour, avec le lien que la balise a montré.
        piecesServies: servies.map((x) => ({ id: x.id, lien: lienPrincipal(x), forme: x.forme })),
        niveauMaxServi: servies.reduce((m, x) => Math.max(m, niveauServi(x.niveau, x.forme)), 0) || niveauMaxServi(p),
        questionEmpreinte: null,
      };
    },
  },
];

/**
 * Le schéma d'un outil TEL QU'UN LECTEUR LE VOIT (ADR 0011). Hors de `LECTEURS_N3`, la
 * propriété `inclure_n3` disparaît : proposer à un modèle un paramètre qui ne peut rien ouvrir
 * lui ferait conclure qu'il l'a mal employé, et relancer. `politique()` reste le verrou ; ceci
 * n'est que la vitrine alignée sur lui.
 */
export function schemaPourLecteur(o: Outil, lecteur: string): Outil["inputSchema"] {
  if (lecteurPeutN3(lecteur) || !("inclure_n3" in o.inputSchema.properties)) return o.inputSchema;
  const { inclure_n3: _retire, ...reste } = o.inputSchema.properties;
  void _retire;
  return { ...o.inputSchema, properties: reste };
}

/**
 * Le banc en NOMBRES : combien de questions par capacité, et la dernière mesure. Jamais une
 * question, jamais un identifiant de papier — `memoryai_etat` promet « aucun contenu ».
 */
async function etatBanc(ctx: ContexteOutils) {
  if (!ctx.banc) return null;
  const [questions, derniere] = await Promise.all([ctx.banc.comptesParCapacite(BANC_COURANT), ctx.banc.derniereMesure(BANC_COURANT)]);
  return {
    nom: BANC_COURANT,
    questions,
    derniereMesure: derniere ? { le: derniere.mesureLe.toISOString(), chercheur: derniere.chercheur, ...derniere.resultat } : null,
  };
}

export function outilParNom(nom: string): Outil | undefined {
  return OUTILS.find((o) => o.name === nom);
}
