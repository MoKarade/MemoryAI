// lib/sauvetage/porte.ts — les écritures, fermées pendant le sauvetage (ADR 0019 §2).
//
// La porte est au POINT D'ÉCRITURE (`ecrireLot`, `ecrireLotPieces`), pas seulement dans les
// routes : le chat, l'apprentissage, une correction de Marc ou la migration de l'inventaire
// écrivent sans passer par `/api/faits`. Revue adversariale du 23/10 : une porte posée sur
// quatre routes laissait cinq chemins ouverts. Les routes traduisent `SauvetageEnCoursError`
// en 503.
//
// Tant que le sauvetage est ouvert et pas clos, un fait encore scellé `v1` peut être repoussé
// par son écrivain. Sa nouvelle empreinte ne reconnaîtrait pas l'ancienne : il entrerait en
// double, en `v2`, et la ligne sauvée heurterait ensuite son double sur l'index unique. Les
// routes d'écriture répondent donc 503 — une PANNE, que l'écrivain retente plus tard, jamais un
// refus qui lui ferait jeter son jeton (même règle que `cle_absente`).

import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** Le mot que Marc tape pour clore le sauvetage (étape 6) : un geste qui rouvre les écritures. */
export const MOT_CLORE = "CLORE";

/** La réponse des routes d'écriture pendant le sauvetage. */
export function reponseSauvetage(): Response {
  return Response.json(
    {
      error: "sauvetage_en_cours",
      message: "La mémoire est en cours de sauvetage (ADR 0019) : rien n'est écrit pour l'instant. Réessaie plus tard.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Vrai tant que le sauvetage est ouvert et pas clos. Une base où la migration 0024 n'a pas
 * tourné LÈVE (table absente) : l'écriture échoue alors fermée, jamais ouverte par défaut.
 */
export async function sauvetageEnCours(db: Base): Promise<boolean> {
  const r = await db.select({ clos: schema.sauvetageEtat.closLe }).from(schema.sauvetageEtat).limit(1);
  return r.length > 0 && r[0]!.clos === null;
}

export class SauvetageEnCoursError extends Error {
  constructor() {
    super("La mémoire est en cours de sauvetage : rien n'est écrit pour l'instant. Réessaie plus tard.");
    this.name = "SauvetageEnCoursError";
  }
}

/**
 * Efface ce que le sauvetage garde d'une ligne (son archive `v1`, ses échecs). Appelé par
 * l'oubli : une ligne retirée de la Mémoire ne survit pas dans l'archive (revue du 23/10).
 */
export async function effacerTraceSauvetage(db: Base, table: "faits" | "pieces", id: string): Promise<void> {
  await db
    .delete(schema.chiffreV1Archive)
    .where(and(eq(schema.chiffreV1Archive.tableNom, table), eq(schema.chiffreV1Archive.ligneId, id)));
  await db
    .delete(schema.sauvetageEchecs)
    .where(and(eq(schema.sauvetageEchecs.tableNom, table), eq(schema.sauvetageEchecs.ligneId, id)));
}
