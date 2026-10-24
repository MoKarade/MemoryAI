// lib/relectureLia.ts — la passe où LIA relit SEULE les faits proposés (ADR 0025, tâche MemoryAI 184).
//
// La décision est dans `./validationLia.ts` (PURE, testée) ; ce module lit la base, la source et le
// modèle, puis écrit la trace. Il n'ajoute AUCUNE règle : s'il fallait en ajouter une, elle irait là-bas.
//
// ⚠️ LA SOURCE EST CELLE QUE MEMORYAI DÉTIENT DÉJÀ : le papier (`pieces`, retrouvé par le `fileId` de
// la provenance) ou la conversation (`conversation:<id>`). Aucun appel à Google, aucun jeton neuf.
// Sans source lisible ici, le fait reste à Marc, et la trace le dit (`sans-source`).
// ⚠️ UN FAIT N'EST RELU QU'UNE FOIS : toute trace, même un doute, le sort des candidats. Relire chaque
// nuit le même doute paierait le modèle pour redire la même chose.
// ⚠️ LA PASSE S'ARRÊTE SUR LE BUDGET (poste `apprentissage`, relu avant chaque appel) ET SUR LE TEMPS :
// le planificateur coupe à 120 s, et une relecture ne doit pas faire perdre la réponse de la passe.

import { and, count, desc, eq, isNotNull, isNull, lte, notExists, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./db/schema";
import { estCanari } from "./canari";
import { chiffrer, dechiffrer, empreinte, type Cle } from "./chiffrement";
import type { ClientModele } from "./chat/agent";
import { depotConversationsDrizzle } from "./conversations/depot";
import { budgetOuvert, coutUsd, jourQuebec, lireUsage, type IdModele } from "./coutChat";
import type { DepotAdmin } from "./depotAdmin";
import type { FaitAvecProvenance } from "./depotLecture";
import { rendreLisible, type FaitLisible, type PolitiqueLecture } from "./lecture";
import { rendreLisiblePiece } from "./pieces/lecture";
import { definition } from "./vocabulaire";
import { decider, demandeRelecture, extraits, lireVerdicts, placeDoutes, PROMPT_RELECTURE, texteDuPapier, valeurDansSource, type Decision, type Relecture } from "./validationLia";

/** Le nom de cette relecture dans la trace : il VERSIONNE la façon de relire, comme un extracteur. */
const EXTRACTEUR_RELECTURE = "lia-relecture-v1";
/** Haiku : la relecture compare un extrait court à une valeur, elle n'a pas à raisonner long. */
const MODELE_RELECTURE: IdModele = "claude-haiku-4-5";
/** Au plus tant de faits lus par passe, et tant par appel au modèle (ceux d'une même source). */
const LOT_RELECTURE = 400;
const FAITS_PAR_APPEL = 8;
/** Le temps de la relecture dans une passe : le planificateur coupe à 120 s, la passe fait autre chose avant. */
const DUREE_MAX_MS = 60_000;
const MAX_TOKENS_SORTIE = 1000;
const PREFIXE_CONVERSATION = "conversation:";
/** Les papiers d'un fait relu sont lus comme le chat les lit au niveau 1 : jamais au-delà. */
const POLITIQUE_N1: PolitiqueLecture = { inclureN2: false, n2Autorise: false, inclureN3: false, n3Autorise: false, inclureProposes: true };

type FinRelecture = "termine" | "rien-a-faire" | "budget" | "temps";

/** Ce que la passe a fait, en NOMBRES seulement : la réponse du planificateur est publique. */
export interface ResultatRelecture {
  relus: number;
  valides: number;
  doutes: number;
  enPile: number;
  sansSource: number;
  exclus: number;
  coutUsd: number;
  fin: FinRelecture;
}

interface NouvelleTrace {
  faitId: string;
  decision: (typeof schema.DECISIONS_LIA)[number];
  verdict: string | null;
  signalCode: boolean;
  raison: string | null;
  empreinteSource: string | null;
  empreinteValeur: string;
  extracteur: string;
  jour: string;
  enPile: boolean;
  reluLe: Date;
}

export interface DepotRelecture {
  /** Les faits `propose` vivants, niveau ≤ 1, non canaris, JAMAIS relus, les plus récents d'abord. */
  candidats(limite: number): Promise<FaitAvecProvenance[]>;
  /** Les prédicats d'une contradiction ouverte (une question à choix posée à Marc). */
  predicatsEnContradiction(): Promise<ReadonlySet<string>>;
  /** Le texte de la source tel que MemoryAI le détient, ou `null` quand il n'est pas lisible ici. */
  source(sourceRef: string, cle: Cle): Promise<string | null>;
  doutesEnPile(jour: string): Promise<number>;
  /** Écrit la trace, PUIS valide le fait s'il le faut (et seulement s'il est encore `propose`). */
  tracer(t: NouvelleTrace, valider: boolean): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;
const V = schema.validationsLia;

export function depotRelectureDrizzle(db: Base): DepotRelecture {
  return {
    async candidats(limite) {
      const rows = await db
        .select({ fait: schema.faits, provenance: schema.provenances })
        .from(schema.faits)
        .innerJoin(schema.provenances, eq(schema.provenances.faitId, schema.faits.id))
        .where(
          and(
            eq(schema.faits.statut, "propose"),
            isNull(schema.faits.supprimeLe),
            isNull(schema.faits.migreEnPiece),
            lte(schema.faits.niveau, 1),
            eq(schema.faits.canari, false),
            notExists(db.select({ x: sql`1` }).from(V).where(eq(V.faitId, schema.faits.id))),
          ),
        )
        .orderBy(desc(schema.faits.creeLe))
        .limit(limite);
      const vus = new Map<string, FaitAvecProvenance>();
      for (const r of rows) if (!vus.has(r.fait.id)) vus.set(r.fait.id, r);
      return [...vus.values()];
    },
    async predicatsEnContradiction() {
      const rows = await db
        .select({ p: schema.questions.predicatVise })
        .from(schema.questions)
        .where(and(eq(schema.questions.statut, "ouverte"), isNotNull(schema.questions.options)));
      return new Set(rows.map((r) => r.p));
    },
    async source(ref, cle) {
      if (ref.startsWith(PREFIXE_CONVERSATION)) {
        const messages = await depotConversationsDrizzle(db).messages(ref.slice(PREFIXE_CONVERSATION.length), cle);
        return messages.length ? messages.map((m) => m.contenu).join("\n") : null;
      }
      const rows = await db
        .select({ piece: schema.pieces })
        .from(schema.pieceExemplaires)
        .innerJoin(schema.pieces, eq(schema.pieces.id, schema.pieceExemplaires.pieceId))
        .where(and(eq(schema.pieceExemplaires.fileId, ref), isNull(schema.pieces.supprimeLe), eq(schema.pieces.statut, "active"), lte(schema.pieces.niveau, 1)))
        .limit(1);
      const piece = rows[0]?.piece;
      const lisible = piece ? rendreLisiblePiece({ piece, exemplaires: [] }, POLITIQUE_N1, cle) : null;
      const texte = lisible ? texteDuPapier(lisible) : "";
      return texte || null;
    },
    async doutesEnPile(jour) {
      const [r] = await db.select({ n: count() }).from(V).where(and(eq(V.jour, jour), eq(V.enPile, true)));
      return r?.n ?? 0;
    },
    async tracer(t, valider) {
      await db.insert(V).values(t);
      if (valider)
        await db
          .update(schema.faits)
          .set({ statut: "valide", valideLe: t.reluLe })
          .where(and(eq(schema.faits.id, t.faitId), eq(schema.faits.statut, "propose"), isNull(schema.faits.supprimeLe)));
    },
  };
}

/** Les doutes de LIA à mettre en tête de la pile : encore `propose`, les plus récents d'abord. */
export async function doutesEnTete(db: Base): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: V.faitId, le: V.reluLe })
    .from(V)
    .innerJoin(schema.faits, eq(schema.faits.id, V.faitId))
    .where(and(eq(V.enPile, true), eq(schema.faits.statut, "propose"), isNull(schema.faits.supprimeLe)))
    .orderBy(desc(V.reluLe));
  return rows.map((r) => r.id);
}

/** Combien de faits VALIDES le sont par LIA (et non par Marc) : l'onglet Apprentissage le dit. */
export async function valideesParLia(db: Base): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(V)
    .innerJoin(schema.faits, eq(schema.faits.id, V.faitId))
    .where(and(eq(V.decision, "valide"), eq(schema.faits.statut, "valide"), isNull(schema.faits.supprimeLe)));
  return r?.n ?? 0;
}

/** Ce que LIA a dit d'UN fait, raison déchiffrée ; `null` s'il n'a jamais été relu. */
export async function relectureDuFait(db: Base, cle: Cle, f: Pick<FaitLisible, "id" | "niveau">): Promise<{ decision: string; signalCode: boolean; raison: string | null } | null> {
  const [t] = await db.select().from(V).where(eq(V.faitId, f.id)).orderBy(desc(V.reluLe)).limit(1);
  if (!t) return null;
  return { decision: t.decision, signalCode: t.signalCode, raison: t.raison ? dechiffrer(cle, t.raison, `${f.id}#lia`, f.niveau) : null };
}

export interface ContexteRelecture {
  client: ClientModele;
  cle: Cle;
  depot: DepotRelecture;
  admin: DepotAdmin;
  maintenant: () => Date;
  /** Le chronomètre de la borne de temps ; injecté pour que le test la fasse tirer. */
  chrono?: () => number;
}

interface Relu {
  lisible: FaitLisible;
  ligne: FaitAvecProvenance;
}

/** La passe : par source, le signal du code d'abord, le modèle seulement pour ce qui le mérite. */
export async function passeRelecture(ctx: ContexteRelecture): Promise<ResultatRelecture> {
  const chrono = ctx.chrono ?? Date.now;
  const debut = chrono();
  const jour = jourQuebec(ctx.maintenant());
  const res: ResultatRelecture = { relus: 0, valides: 0, doutes: 0, enPile: 0, sansSource: 0, exclus: 0, coutUsd: 0, fin: "termine" };
  const budgetReste = async () =>
    budgetOuvert(await ctx.admin.depenseDuJourUsd(jour, "apprentissage"), "apprentissage", await ctx.admin.plafonds());
  if (!(await budgetReste())) return { ...res, fin: "budget" };

  const lignes = await ctx.depot.candidats(LOT_RELECTURE);
  if (lignes.length === 0) return { ...res, fin: "rien-a-faire" };
  const contradictions = await ctx.depot.predicatsEnContradiction();
  let place = placeDoutes(await ctx.depot.doutesEnPile(jour));

  const parSource = new Map<string, Relu[]>();
  for (const ligne of lignes) {
    try {
      const lisible = rendreLisible(ligne, ctx.cle);
      const ref = ligne.provenance?.sourceRef ?? "";
      parSource.set(ref, [...(parSource.get(ref) ?? []), { lisible, ligne }]);
    } catch {
      // Un fait illisible (clé tournée, ligne altérée) n'est ni relu ni validé : il reste à Marc.
      res.exclus++;
    }
  }

  const tracer = async (r: Relu, d: Decision | { genre: "sans-source" }, signalCode: boolean, relecture: Relecture | null, lu: string | null) => {
    const doute = d.genre === "doute";
    const enPile = doute && place > 0;
    if (enPile) place--;
    const f = r.lisible;
    await ctx.depot.tracer(
      {
        faitId: f.id,
        decision: d.genre === "valider" ? "valide" : d.genre === "doute" ? "doute" : "sans-source",
        verdict: relecture?.verdict ?? null,
        signalCode,
        raison: relecture ? chiffrer(ctx.cle, relecture.raison, `${f.id}#lia`, f.niveau) : null,
        empreinteSource: lu === null ? null : empreinte(ctx.cle, "lia-source", lu),
        empreinteValeur: empreinte(ctx.cle, "lia-valeur", f.valeur),
        extracteur: `${EXTRACTEUR_RELECTURE}|${MODELE_RELECTURE}`,
        jour,
        enPile,
        reluLe: ctx.maintenant(),
      },
      d.genre === "valider",
    );
    res.relus++;
    if (d.genre === "valider") res.valides++;
    else if (doute) res.doutes++;
    else res.sansSource++;
    if (enPile) res.enPile++;
  };

  for (const [ref, faits] of parSource) {
    if (chrono() - debut > DUREE_MAX_MS) return { ...res, fin: "temps" };
    const texte = ref ? await ctx.depot.source(ref, ctx.cle) : null;
    if (texte === null) {
      for (const r of faits) await tracer(r, { genre: "sans-source" }, false, null, null);
      continue;
    }

    const aRelire: { r: Relu; c: Parameters<typeof decider>[0] }[] = [];
    for (const r of faits) {
      const f = r.lisible;
      const c = {
        niveau: f.niveau,
        canari: r.ligne.fait.canari || estCanari(f.valeur),
        enContradiction: contradictions.has(f.predicat),
        horsVocabulaire: definition(f.predicat, r.ligne.fait.versionVocabulaire) === null,
      };
      const signal = valeurDansSource(f.valeur, f.valeurType, texte);
      const avant = decider(c, signal, null);
      if (avant.genre === "exclu") res.exclus++;
      else if (!signal) await tracer(r, avant, false, null, texte);
      else aRelire.push({ r, c });
    }

    for (let i = 0; i < aRelire.length; i += FAITS_PAR_APPEL) {
      if (chrono() - debut > DUREE_MAX_MS) return { ...res, fin: "temps" };
      if (!(await budgetReste())) return { ...res, fin: "budget" };
      const lot = aRelire.slice(i, i + FAITS_PAR_APPEL);
      const extrait = extraits(texte, lot.map(({ r }) => ({ valeur: r.lisible.valeur, type: r.lisible.valeurType })));
      try {
        const reponse = await ctx.client.create({
          model: MODELE_RELECTURE,
          max_tokens: MAX_TOKENS_SORTIE,
          system: PROMPT_RELECTURE,
          tools: [],
          messages: [{ role: "user", content: demandeRelecture(extrait, lot.map(({ r }) => r.lisible)) }],
        });
        // COMPTÉ AVANT D'ÊTRE LU : l'appel est facturé même si la réponse est inutilisable.
        const { usage } = lireUsage(reponse.usage);
        const cout = coutUsd(MODELE_RELECTURE, usage);
        await ctx.admin.enregistrerDepense({ jour, poste: "apprentissage", modele: MODELE_RELECTURE, ...usage, coutUsd: cout });
        res.coutUsd += cout;
        const lus = lireVerdicts(
          reponse.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("\n"),
        );
        for (const [k, { r, c }] of lot.entries()) {
          const relecture = lus.get(k + 1) ?? null;
          await tracer(r, decider(c, true, relecture), true, relecture, extrait);
        }
      } catch (err) {
        // ⚠️ Un appel qui échoue ne trace RIEN : ces faits seront relus à la prochaine passe. Un
        // échec par lot ne partage pas le drapeau d'arrêt de la boucle (leçon DriveAI).
        console.error("[relecture] lot impossible", err);
      }
    }
  }
  return res;
}
