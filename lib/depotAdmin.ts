// lib/depotAdmin.ts — ce que MARC fait à sa mémoire, et personne d'autre : valider, rejeter,
// oublier, purger, lire la file. Chaque fonction est appelée depuis une Server Action qui a
// revérifié la session (`lib/session.ts`) — jamais depuis un outil MCP ni le chat.
//
// « Oublier » = suppression logique du fait + une ligne dans `oublis` : le fait ne revient
// ni par le rejeu, ni par le rattrapage, ni par le flux (ADR 0001 §3). « Rejeter » garde la
// ligne (statut `rejete`, jamais servie) pour qu'un rejeu de la même source ne la RE-PROPOSE
// pas (idempotence par empreinte). « Purger » efface faits et provenances — pas les oublis,
// qui doivent survivre pour tenir leur promesse, ni le journal, qui est l'audit.

import { and, count, desc, eq, inArray, isNull, ne, sql, sum } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Cle } from "./chiffrement";
import { PLAFONDS_DEFAUT_USD_PAR_JOUR, plafondValide, POSTES, type Poste } from "./coutChat";
import * as schema from "./db/schema";
import type { FaitAvecProvenance } from "./depotLecture";
import { nettoyerVoix } from "./chat/voix";
import { empreinteOubli } from "./ecrireFaits";
import { definition } from "./vocabulaire";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export const MOT_DE_PURGE = "SUPPRIMER";

export interface DepotAdmin {
  aValider(limite: number): Promise<FaitAvecProvenance[]>;
  /**
   * Les faits `perime` VIVANTS, le plus récemment périmé d'abord.
   *
   * ⚠️ Cette liste n'existait pas, et son absence a coûté des données le 17/09 : valider un
   * doublon fait passer `perime` le fait qu'il remplace (`valider`, plus bas), et **aucune
   * surface ne montrait ce qui avait été périmé**. Marc a validé six doublons proposés par le
   * cron, cinq faits corrects sont passés `perime`, et il n'existait aucun moyen de les voir
   * ni de revenir en arrière. Le mutateur qui répare, lui, existait déjà : `valider` accepte
   * n'importe quel fait vivant, y compris périmé. Il manquait le FIL, pas la capacité.
   */
  perimes(limite: number): Promise<FaitAvecProvenance[]>;
  parId(id: string): Promise<FaitAvecProvenance | null>;
  /**
   * Les autres faits tirés de la MÊME source (même `provenances.source_ref`), le fait
   * courant exclu. [L33a] — Marc, le 18/09 : « voir le document lié, ou tous les documents
   * liés ».
   *
   * ⚠️ Aucune table neuve, aucun index neuf : `provenances_source` existe depuis l'origine,
   * posé exactement pour cette lecture. Ce qui manquait était la REQUÊTE, et avant elle la
   * publication de `sourceRef` que `rendreLisible` jetait.
   */
  autresDeLaMemeSource(sourceRef: string, sauf: string, limite: number): Promise<FaitAvecProvenance[]>;
  /** Valide ; si le prédicat n'est pas `multi`, les autres faits validés du même prédicat passent `perime`. */
  valider(id: string, maintenant: Date): Promise<"ok" | "introuvable">;
  rejeter(id: string): Promise<"ok" | "introuvable">;
  /**
   * Marquer un fait REMPLACÉ. [L33b].
   *
   * ⚠️ `perime` n'est PAS `rejete`, et la différence est ce que le statut AFFIRME :
   * « remplacé par un plus récent » contre « faux ». Corriger une valeur ne dit pas que
   * l'ancienne était un mensonge — elle était vraie à sa date, et c'est pour ça qu'on la garde.
   *
   * ⚠️ Ce mutateur n'existe que pour les prédicats `multi`. Pour les autres, `valider`
   * périme déjà l'ancien tout seul — l'appeler ici aussi serait une règle et demie.
   */
  perimer(id: string): Promise<"ok" | "introuvable">;
  oublier(id: string, cle: Cle, raison: string | null, maintenant: Date): Promise<"ok" | "introuvable">;
  /** Efface faits et provenances. Exige le mot exact — la vérification est ICI, pas seulement au formulaire. */
  /** Les prédicats qui attendent, le plus employé d'abord (ADR 0004 §2.3). */
  predicatsEnQuarantaine(limite: number): Promise<
    { predicat: string; nombre: number; extracteurs: string[]; premiereVue: Date }[]
  >;
  /**
   * Le SECOND chemin de sortie de quarantaine : Marc, d'un clic. `refuse` est ABSORBANT —
   * trois extracteurs ne l'annulent pas (`apresProposition`), sinon il suffirait de trois
   * sources pour défaire sa décision.
   */
  trancherPredicat(predicat: string, verdict: "accepte" | "refuse", maintenant: Date): Promise<"ok" | "introuvable">;
  purger(confirmation: string): Promise<{ faits: number } | "refuse">;
  /** La dépense d'UN poste, ce jour-là. Le poste est obligatoire : un défaut ferait tomber
   *  l'apprentissage dans le budget du chat sans que personne ne le voie. */
  depenseDuJourUsd(jour: string, poste: Poste): Promise<number>;
  /** Tous les postes du jour, pour l'écran — un poste sans dépense rend 0, jamais l'absence. */
  depenseDuJourParPoste(jour: string): Promise<Record<Poste, number>>;
  depenseTotaleUsd(): Promise<{ total: number; appels: number }>;
  /**
   * La dépense par JOUR et par poste, du plus ancien au plus récent. [L38].
   *
   * ⚠️ Le jour n'est pas calculé ici : la colonne `jour` de `depenses_chat` le porte déjà, et
   * elle a été écrite à l'heure du Québec au moment de la dépense. Le recalculer depuis un
   * horodatage donnerait un autre découpage que celui que le PLAFOND a utilisé — donc un
   * histogramme qui ne correspondrait pas aux jours où le budget a coupé.
   */
  depenseParJour(limite: number): Promise<{ jour: string; parPoste: Record<Poste, number> }[]>;
  /**
   * Les plafonds EFFECTIFS : ce que Marc a réglé, ou le défaut du 16/09 pour ce qu'il n'a pas
   * réglé. [L34].
   *
   * ⚠⚠ Une ligne ABSENTE vaut le DÉFAUT, jamais « illimité » — c'est ce qui garde vraie la
   * règle de l'ADR 0001 §5.5 (« plafond dur, non désactivable ») maintenant que la valeur vient
   * de la base. Une table vide, une base fraîchement migrée, une ligne supprimée à la main :
   * tous ces états rendent le plafond du 16/09, pas l'absence de plafond.
   *
   * ⚠️ Et une valeur ILLISIBLE en base (une colonne altérée, un `NaN`) vaut le défaut aussi,
   * par `plafondValide` : `depense < NaN` est FAUX, donc un plafond illisible couperait tout
   * silencieusement — l'inverse du danger, mais un mensonge quand même.
   */
  plafonds(): Promise<Record<Poste, number>>;
  /** Écrire un plafond. La valeur est ramenée dans les bornes AVANT d'atteindre la base. */
  reglerPlafond(poste: Poste, usdParJour: number): Promise<"ok">;
  /**
   * La VOIX de Lia, telle que Marc l'a écrite, ou `null` s'il n'en a jamais réglé. [L27].
   * ⚠️ Ce qui sort d'ici n'est PAS cru sur parole : `baliserVoix` re-coupe et ré-échappe.
   */
  voixLia(): Promise<string | null>;
  /**
   * Écrire la voix, ou l'effacer avec un texte vide.
   *
   * ⚠️ La validation (`nettoyerVoix` : 600 caractères, ni balise ni URL) est FAITE ICI et pas
   * seulement par l'action : la même règle que `reglerPlafond` avec `plafondValide`. Un
   * appelant qui ferait confiance à l'écran ne protégerait pas le prompt.
   */
  reglerVoixLia(brut: string, maintenant: Date): Promise<{ ok: true; effacee: boolean } | { ok: false; raison: string }>;
  enregistrerDepense(d: typeof schema.depensesChat.$inferInsert): Promise<void>;
}

export function depotAdminDrizzle(db: Base): DepotAdmin {
  const vivant = (id: string) => and(eq(schema.faits.id, id), isNull(schema.faits.supprimeLe));
  return {
    async aValider(limite) {
      const rows = await db
        .select({ fait: schema.faits, provenance: schema.provenances })
        .from(schema.faits)
        .leftJoin(schema.provenances, eq(schema.provenances.faitId, schema.faits.id))
        .where(and(isNull(schema.faits.supprimeLe), eq(schema.faits.statut, "propose")))
        .orderBy(desc(schema.faits.creeLe))
        .limit(limite);
      const vus = new Map<string, FaitAvecProvenance>();
      for (const r of rows) if (!vus.has(r.fait.id)) vus.set(r.fait.id, { fait: r.fait, provenance: r.provenance });
      return [...vus.values()];
    },
    async perimes(limite) {
      const rows = await db
        .select({ fait: schema.faits, provenance: schema.provenances })
        .from(schema.faits)
        .leftJoin(schema.provenances, eq(schema.provenances.faitId, schema.faits.id))
        .where(and(isNull(schema.faits.supprimeLe), eq(schema.faits.statut, "perime")))
        // Le plus récemment CRÉÉ d'abord : `perime` n'a pas d'horodatage à lui (le statut est
        // écrit sans date, `valider` ne pose que `valide_le` sur le gagnant). Trier par
        // création est donc le seul ordre HONNÊTE ici — et il ne mélange rien, puisque le
        // fait périmé est toujours l'ancien.
        .orderBy(desc(schema.faits.creeLe))
        .limit(limite);
      const vus = new Map<string, FaitAvecProvenance>();
      for (const r of rows) if (!vus.has(r.fait.id)) vus.set(r.fait.id, { fait: r.fait, provenance: r.provenance });
      return [...vus.values()];
    },
    async parId(id) {
      const rows = await db
        .select({ fait: schema.faits, provenance: schema.provenances })
        .from(schema.faits)
        .leftJoin(schema.provenances, eq(schema.provenances.faitId, schema.faits.id))
        .where(vivant(id))
        .limit(1);
      return rows[0] ? { fait: rows[0].fait, provenance: rows[0].provenance } : null;
    },
    async autresDeLaMemeSource(sourceRef, sauf, limite) {
      // Un `source_ref` vide ne désigne rien. ⚠️ Ce n'est PAS une protection contre un
      // balayage : `where source_ref = ''` ne rendrait aucune ligne écrite par le contrat
      // (`min(1)`). Ce dont ce repli protège est plus étroit et réel — la COLONNE, elle,
      // accepte la chaîne vide (`notNull` ne l'interdit pas), donc une ligne posée hors du
      // contrat rattacherait tous les autres vides entre eux. « Pas de source » n'est pas
      // « la même source ». Le commentaire précédent annonçait un balayage : c'était faux, et
      // la garde écrite d'après lui ne mesurait rien (perturbation MUETTE, 18/09).
      if (!sourceRef.trim()) return [];
      const rows = await db
        .select({ fait: schema.faits, provenance: schema.provenances })
        .from(schema.provenances)
        .innerJoin(schema.faits, eq(schema.provenances.faitId, schema.faits.id))
        .where(
          and(
            eq(schema.provenances.sourceRef, sourceRef),
            isNull(schema.faits.supprimeLe),
            ne(schema.faits.id, sauf),
          ),
        )
        .orderBy(desc(schema.faits.creeLe))
        .limit(limite);
      const vus = new Map<string, FaitAvecProvenance>();
      for (const r of rows) if (!vus.has(r.fait.id)) vus.set(r.fait.id, { fait: r.fait, provenance: r.provenance });
      return [...vus.values()];
    },
    async perimer(id) {
      const [f] = await db.select().from(schema.faits).where(vivant(id));
      if (!f) return "introuvable";
      await db.update(schema.faits).set({ statut: "perime" }).where(eq(schema.faits.id, id));
      return "ok";
    },
    async valider(id, maintenant) {
      const [f] = await db.select().from(schema.faits).where(vivant(id));
      if (!f) return "introuvable";
      const def = definition(f.predicat, f.versionVocabulaire);
      if (def && !def.multi) {
        // Un employeur courant remplace le précédent : l'ancien devient `perime`, pas effacé.
        await db
          .update(schema.faits)
          .set({ statut: "perime" })
          .where(and(eq(schema.faits.sujet, f.sujet), eq(schema.faits.predicat, f.predicat), eq(schema.faits.statut, "valide"), ne(schema.faits.id, id)));
      }
      await db.update(schema.faits).set({ statut: "valide", valideLe: maintenant }).where(eq(schema.faits.id, id));
      return "ok";
    },
    async rejeter(id) {
      const r = await db.update(schema.faits).set({ statut: "rejete" }).where(vivant(id)).returning({ id: schema.faits.id });
      return r.length ? "ok" : "introuvable";
    },
    async oublier(id, cle, raison, maintenant) {
      const f = await this.parId(id);
      if (!f) return "introuvable";
      if (f.provenance) {
        await db
          .insert(schema.oublis)
          .values({ empreinte: empreinteOubli(cle, f.provenance.sourceRef, f.fait.predicat, f.fait.sujet), raison })
          .onConflictDoNothing();
      }
      await db.update(schema.faits).set({ supprimeLe: maintenant, statut: "rejete" }).where(eq(schema.faits.id, id));
      return "ok";
    },
    async predicatsEnQuarantaine(limite) {
      const rows = await db
        .select({
          predicat: schema.predicatsProposes.predicat,
          nombre: schema.predicatsProposes.nombre,
          extracteurs: schema.predicatsProposes.extracteurs,
          premiereVue: schema.predicatsProposes.premiereVue,
        })
        .from(schema.predicatsProposes)
        .where(eq(schema.predicatsProposes.statut, "en_quarantaine"))
        .orderBy(desc(schema.predicatsProposes.nombre))
        .limit(limite);
      return rows.map((r) => {
        let extracteurs: string[] = [];
        try {
          const brut: unknown = JSON.parse(r.extracteurs);
          if (Array.isArray(brut)) extracteurs = brut.filter((e): e is string => typeof e === "string");
        } catch {
          // Illisible ⇒ vide, jamais inventé : un « ? » vaut mieux qu'un nom fabriqué.
        }
        return { predicat: r.predicat, nombre: r.nombre, extracteurs, premiereVue: r.premiereVue };
      });
    },

    async trancherPredicat(predicat, verdict, maintenant) {
      // ⚠️ `WHERE statut = 'en_quarantaine'` : on ne tranche que ce qui ATTEND. Sans cette
      // condition, un second clic réécrirait la trace d'une sortie déjà faite — et un
      // prédicat accepté par les trois sources se ferait re-marquer « marc ».
      const rows = await db
        .update(schema.predicatsProposes)
        .set({
          statut: verdict,
          sortieLe: verdict === "accepte" ? maintenant : null,
          sortiePar: verdict === "accepte" ? "marc" : null,
        })
        .where(
          and(
            eq(schema.predicatsProposes.predicat, predicat),
            eq(schema.predicatsProposes.statut, "en_quarantaine"),
          ),
        )
        .returning({ p: schema.predicatsProposes.predicat });
      return rows.length ? "ok" : "introuvable";
    },

    async purger(confirmation) {
      if (confirmation !== MOT_DE_PURGE) return "refuse";
      const ids = (await db.select({ id: schema.faits.id }).from(schema.faits)).map((r) => r.id);
      if (ids.length) {
        await db.delete(schema.provenances).where(inArray(schema.provenances.faitId, ids));
        await db.delete(schema.faits).where(inArray(schema.faits.id, ids));
      }
      return { faits: ids.length };
    },
    async depenseDuJourUsd(jour, poste) {
      const [r] = await db
        .select({ s: sum(schema.depensesChat.coutUsd) })
        .from(schema.depensesChat)
        .where(and(eq(schema.depensesChat.jour, jour), eq(schema.depensesChat.poste, poste)));
      return Number(r?.s ?? 0);
    },
    async depenseDuJourParPoste(jour) {
      const rows = await db
        .select({ p: schema.depensesChat.poste, s: sum(schema.depensesChat.coutUsd) })
        .from(schema.depensesChat)
        .where(eq(schema.depensesChat.jour, jour))
        .groupBy(schema.depensesChat.poste);
      // Un poste sans ligne vaut 0, jamais `undefined` : un seul `undefined` dans une addition
      // empoisonne tout le cumul (leçon DriveAI, CLAUDE.md §9 n° 3).
      const par = Object.fromEntries(POSTES.map((p) => [p, 0])) as Record<Poste, number>;
      for (const r of rows) par[r.p as Poste] = Number(r.s ?? 0);
      return par;
    },
    async depenseParJour(limite) {
      // Les jours les plus RÉCENTS d'abord pour la limite, puis remis dans l'ordre de lecture.
      const joursRecents = await db
        .select({ jour: schema.depensesChat.jour })
        .from(schema.depensesChat)
        .groupBy(schema.depensesChat.jour)
        .orderBy(desc(schema.depensesChat.jour))
        .limit(limite);
      if (joursRecents.length === 0) return [];
      const rows = await db
        .select({
          jour: schema.depensesChat.jour,
          poste: schema.depensesChat.poste,
          cout: sql<number>`coalesce(sum(${schema.depensesChat.coutUsd}), 0)`,
        })
        .from(schema.depensesChat)
        .where(inArray(schema.depensesChat.jour, joursRecents.map((j) => j.jour)))
        .groupBy(schema.depensesChat.jour, schema.depensesChat.poste);
      const parJour = new Map<string, Record<Poste, number>>();
      for (const j of joursRecents) {
        // ⚠️ Chaque poste à zéro par défaut : un poste ABSENT d'un jour a bien dépensé zéro ce
        // jour-là, contrairement à un JOUR absent, qui n'existe pas. Les deux absences ne
        // veulent pas dire la même chose, et un `undefined` dans une somme donnerait `NaN`.
        parJour.set(j.jour, Object.fromEntries(POSTES.map((p) => [p, 0])) as Record<Poste, number>);
      }
      for (const r of rows) {
        const entree = parJour.get(r.jour);
        if (entree) entree[r.poste] = Number(r.cout) || 0;
      }
      return [...parJour.entries()]
        .map(([jour, parPoste]) => ({ jour, parPoste }))
        .sort((a, b) => a.jour.localeCompare(b.jour));
    },
    async plafonds() {
      const lignes = await db.select().from(schema.plafonds);
      const effectifs = { ...PLAFONDS_DEFAUT_USD_PAR_JOUR };
      for (const l of lignes) effectifs[l.poste] = plafondValide(l.usdParJour, l.poste);
      return effectifs;
    },
    async reglerPlafond(poste, usdParJour) {
      const valeur = plafondValide(usdParJour, poste);
      await db
        .insert(schema.plafonds)
        .values({ poste, usdParJour: valeur, modifieLe: new Date() })
        .onConflictDoUpdate({ target: schema.plafonds.poste, set: { usdParJour: valeur, modifieLe: new Date() } });
      return "ok";
    },
    async voixLia() {
      const [r] = await db.select({ texte: schema.voixLia.texte }).from(schema.voixLia).limit(1);
      return r?.texte ?? null;
    },
    async reglerVoixLia(brut, maintenant) {
      const v = nettoyerVoix(brut);
      if (!v.ok) return { ok: false, raison: v.raison };
      if (v.valeur === null) {
        await db.delete(schema.voixLia);
        return { ok: true, effacee: true };
      }
      await db
        .insert(schema.voixLia)
        .values({ id: 1, texte: v.valeur, modifieLe: maintenant })
        .onConflictDoUpdate({ target: schema.voixLia.id, set: { texte: v.valeur, modifieLe: maintenant } });
      return { ok: true, effacee: false };
    },
    async depenseTotaleUsd() {
      const [r] = await db.select({ s: sum(schema.depensesChat.coutUsd), n: count() }).from(schema.depensesChat);
      return { total: Number(r?.s ?? 0), appels: Number(r?.n ?? 0) };
    },
    async enregistrerDepense(d) {
      await db.insert(schema.depensesChat).values(d);
    },
  };
}

/**
 * Le nombre de faits VALIDÉS par prédicat — ce que le producteur de questions reçoit, et la
 * SEULE chose qu'il reçoit (`lib/questions/producteur.ts`). Validés seulement : un fait
 * proposé n'est pas encore une connaissance, et une question sur un trou déjà comblé par une
 * proposition en attente ferait doublon avec `/a-valider`.
 */
export async function comptesParPredicatValides(db: Base): Promise<Record<string, number>> {
  const rows = await db
    .select({ p: schema.faits.predicat, n: count() })
    .from(schema.faits)
    .where(and(isNull(schema.faits.supprimeLe), eq(schema.faits.statut, "valide")))
    .groupBy(schema.faits.predicat);
  return Object.fromEntries(rows.map((r) => [r.p, Number(r.n)]));
}

/** Le nombre de faits par domaine, pour `/moi` et le summary. */
/**
 * Les faits validés par domaine — la ventilation publiée au hub.
 *
 * ⚠️ Même condition que `comptes()` de `lib/depotLecture.ts`, et pour la même raison : un
 * fait migré en pièce n'est plus servi, donc il ne compte pas. Sans ce filtre, la somme des
 * lignes « Faits validés par domaine » dépasserait la métrique « Faits validés » d'à côté
 * dès que les deux ne filtrent pas pareil — c'est la classe de défaut qui a mis
 * `/hub/summary` en 500 le 15/09 (un plafond d'un côté, un compte de l'autre).
 */
export async function comptesParDomaine(db: Base): Promise<Record<string, number>> {
  const dom = sql<string>`split_part(${schema.faits.predicat}, '.', 1)`;
  const rows = await db
    .select({ d: dom, n: count() })
    .from(schema.faits)
    .where(
      and(
        isNull(schema.faits.supprimeLe),
        isNull(schema.faits.migreEnPiece),
        eq(schema.faits.statut, "valide"),
      ),
    )
    .groupBy(dom);
  return Object.fromEntries(rows.map((r) => [r.d, Number(r.n)]));
}
