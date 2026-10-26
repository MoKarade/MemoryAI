// lib/idees/geste.ts — les gestes de Marc sur une idée de LIA (ADR 0027 §4) : la retenir, l'écarter.
// I/O : l'état d'une idée ne change que par un geste de Marc, jamais par LIA.
//
// ⚠️ UNE ÉCRITURE GARDÉE : le `where` porte les états de départ permis. Un double clic, ou un geste
// sur une idée que la passe vient de passer à autre chose, ne change rien et le dit (`false`) au
// lieu d'écraser. Seul l'état et `maj_le` bougent : ni les raisons, ni l'utilité, ni le nom.
// ⚠️ Écartée = jamais reproposée : la passe ne retouche pas une écartée et son empreinte reste.

import { and, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { EtatIdee } from "./regles";
import { idees } from "./table";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export type GesteIdee = "retenir" | "ecarter";

/** De quels états un geste part, et où il arrive. « Faite » n'est jamais un geste : elle suit l'issue liée. */
const TRANSITIONS: Readonly<Record<GesteIdee, { de: readonly EtatIdee[]; vers: EtatIdee }>> = {
  retenir: { de: ["proposee"], vers: "retenue" },
  ecarter: { de: ["proposee", "retenue"], vers: "ecartee" },
};

/** `true` : l'idée a changé d'état ; `false` : elle n'existe pas ou n'était plus dans un état de départ. */
export async function appliquerGeste(db: Base, id: string, geste: GesteIdee, maintenant: Date): Promise<boolean> {
  const t = TRANSITIONS[geste];
  const lignes = await db
    .update(idees)
    .set({ etat: t.vers, majLe: maintenant })
    .where(and(eq(idees.id, id), inArray(idees.etat, [...t.de])))
    .returning({ id: idees.id });
  return lignes.length === 1;
}
