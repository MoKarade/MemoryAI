// lib/memoire/depotAcces.ts — les lectures de l'onglet Accès (`app/memoire/acces`). Que des
// comptes et des métadonnées : aucune valeur de fait n'est lue, rien n'est déchiffré.
//
// ⚠️ Les faits comptés sont ceux que la mémoire SERT (`conditionServis` : ni supprimés, ni
// migrés en pièce) et validés, comme la page Mémoire : deux onglets qui ne compteraient pas la
// même chose se contrediraient sous les yeux de Marc.

import { and, count, desc, eq, gte } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { conditionServis } from "@/lib/depotLecture";
import type { Niveau } from "@/lib/vocabulaire";
import { compterIds, type LigneJournal } from "./acces";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export interface DepotAcces {
  faitsParNiveau(): Promise<Partial<Record<Niveau, number>>>;
  journal(limite: number, niveau: Niveau | null): Promise<LigneJournal[]>;
  lecturesDepuis(depuis: Date, limite: number): Promise<{ ts: Date; lecteur: string }[]>;
  oublis(limite: number): Promise<{ total: number; derniers: Date[] }>;
}

export function depotAccesDrizzle(db: Base): DepotAcces {
  const j = schema.accesJournal;
  return {
    async faitsParNiveau() {
      const lignes = await db
        .select({ niveau: schema.faits.niveau, n: count() })
        .from(schema.faits)
        .where(and(conditionServis(), eq(schema.faits.statut, "valide")))
        .groupBy(schema.faits.niveau);
      return Object.fromEntries(lignes.map((l) => [l.niveau, l.n]));
    },
    async journal(limite, niveau) {
      const lignes = await db
        .select({ id: j.id, ts: j.ts, lecteur: j.lecteur, outil: j.outil, niveauMaxServi: j.niveauMaxServi, idsFaits: j.idsFaits, idsPieces: j.idsPieces })
        .from(j)
        .where(niveau === null ? undefined : eq(j.niveauMaxServi, niveau))
        .orderBy(desc(j.id))
        .limit(limite);
      return lignes.map(({ idsFaits, idsPieces, ...l }) => ({ ...l, nFaits: compterIds(idsFaits), nPieces: compterIds(idsPieces) }));
    },
    async lecturesDepuis(depuis, limite) {
      return db.select({ ts: j.ts, lecteur: j.lecteur }).from(j).where(gte(j.ts, depuis)).orderBy(desc(j.id)).limit(limite);
    },
    async oublis(limite) {
      const [total] = await db.select({ n: count() }).from(schema.oublis);
      const derniers = await db.select({ creeLe: schema.oublis.creeLe }).from(schema.oublis).orderBy(desc(schema.oublis.creeLe)).limit(limite);
      return { total: total?.n ?? 0, derniers: derniers.map((d) => d.creeLe) };
    },
  };
}
