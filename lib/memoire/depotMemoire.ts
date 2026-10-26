// lib/memoire/depotMemoire.ts — les lectures des tuiles de l'onglet Mémoire (maquette v5, écart C).
// Des COMPTES et des dates : aucune valeur de fait, rien de déchiffré.

import { and, avg, count, countDistinct, eq, isNull, max, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { conditionServis } from "@/lib/depotLecture";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export interface DepotMemoire {
  /** Faits validés servis, par type de source, et la date de la plus récente provenance. */
  faitsParSource(): Promise<{ source: (typeof schema.SOURCES)[number]; n: number; dernier: Date | null }[]>;
  /** Les papiers gardés (non supprimés). */
  nombrePapiers(): Promise<number>;
  /** Les papiers gardés, par dossier DriveAI (`domaine`, en clair ; `null` : sans dossier). */
  papiersParDomaine(): Promise<{ domaine: string | null; n: number }[]>;
  /**
   * L'état du réseau ENREGISTRÉ (tâche MemoryAI 187) : des comptes, une force moyenne par règle et
   * la date du dernier lien écrit. Rien n'est déchiffré, et aucun identifiant ne sort.
   *
   * ⚠️ Les liens de RÈGLE et les liens DEVINÉS sont comptés à part (`liens.origine`) : les
   * additionner présenterait une ressemblance de sens comme un rapport établi.
   */
  etatReseau(): Promise<{
    noeuds: number;
    domaines: number;
    etablis: number;
    devines: number;
    parType: { type: string; n: number; poidsMoyen: number }[];
    derniere: Date | null;
  }>;
}

export function depotMemoireDrizzle(db: Base): DepotMemoire {
  const f = schema.faits;
  const p = schema.provenances;
  return {
    async faitsParSource() {
      const lignes = await db
        .select({ source: p.sourceType, n: countDistinct(p.faitId), dernier: max(p.creeLe) })
        .from(p)
        .innerJoin(f, eq(f.id, p.faitId))
        .where(and(conditionServis(), eq(f.statut, "valide")))
        .groupBy(p.sourceType);
      return lignes.map((l) => ({ source: l.source, n: Number(l.n), dernier: l.dernier ? new Date(l.dernier) : null }));
    },
    async nombrePapiers() {
      const [r] = await db.select({ n: count() }).from(schema.pieces).where(isNull(schema.pieces.supprimeLe));
      return Number(r?.n ?? 0);
    },
    async papiersParDomaine() {
      const pc = schema.pieces;
      const lignes = await db.select({ domaine: pc.domaine, n: count() }).from(pc).where(isNull(pc.supprimeLe)).groupBy(pc.domaine);
      return lignes.map((l) => ({ domaine: l.domaine, n: Number(l.n) }));
    },
    async etatReseau() {
      const l = schema.liens;
      const servis = and(conditionServis(), eq(f.statut, "valide"));
      const [[faits], [domaines], parType] = await Promise.all([
        db.select({ n: count() }).from(f).where(servis),
        db.select({ n: countDistinct(sql<string>`split_part(${f.predicat}, '.', 1)`) }).from(f).where(servis),
        db
          .select({ type: l.type, origine: l.origine, n: count(), poids: avg(l.poids), dernier: max(l.creeLe) })
          .from(l)
          .groupBy(l.type, l.origine),
      ]);
      let etablis = 0;
      let devines = 0;
      let derniere: Date | null = null;
      const types: { type: string; n: number; poidsMoyen: number }[] = [];
      for (const r of parType) {
        const n = Number(r.n);
        if (r.origine === "modele") devines += n;
        else etablis += n;
        types.push({ type: r.type, n, poidsMoyen: Number(r.poids ?? 0) });
        const d = r.dernier ? new Date(r.dernier) : null;
        if (d && (derniere === null || d > derniere)) derniere = d;
      }
      return { noeuds: Number(faits?.n ?? 0), domaines: Number(domaines?.n ?? 0), etablis, devines, parType: types, derniere };
    },
  };
}
