// lib/depotPerimetres.ts — ce que Marc accorde à chaque app (ADR 0001 §3, table `perimetres`).
//
// ⚠️ CETTE TABLE ÉTAIT LUE MAIS JAMAIS ÉCRITE. `depotFaits.perimetre()` la consulte avant
// chaque écriture depuis le lot 3 ; aucune page ne la remplissait — un champ sans producteur,
// exactement la classe de défaut que l'écosystème a payée plusieurs fois (« le moteur consulte
// en premier, un commentaire cite le ticket, et 100 % des cas tombent sur le repli »).
//
// Le repli, ici, est SAIN : pas de ligne ⇒ aucune restriction supplémentaire, le jeton décide
// seul. Mais il rendait le périmètre INUTILISABLE — et le widget (lot 12) en dépend
// entièrement : sans périmètre écrit, une app hôte verrait tout ce que la mémoire porte.

import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./db/schema";
import type { Perimetre } from "./db/schema";
import { domaines as domainesDuVocabulaire } from "./vocabulaire";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export interface ReglagePerimetre {
  domaines: string[];
  niveauMax: number;
  role: "lecture" | "ecriture";
  admetInvites: boolean;
  domicile: boolean;
}

export interface DepotPerimetres {
  tous(): Promise<Perimetre[]>;
  parApp(appId: string): Promise<Perimetre | null>;
  /** Écrit ou remplace le périmètre d'une app. Marc seul, depuis l'interface. */
  regler(appId: string, r: ReglagePerimetre, maintenant: Date): Promise<void>;
  /** Retire la ligne : l'app retombe sur ce que son JETON permet, sans restriction en plus. */
  retirer(appId: string): Promise<void>;
}

/**
 * Lit un réglage venu d'un formulaire. PURE, et STRICTE : un domaine hors vocabulaire est
 * REFUSÉ, pas ignoré. L'ignorer laisserait croire à Marc qu'il a accordé quelque chose.
 */
export function lireReglage(fd: {
  get(n: string): FormDataEntryValue | null;
  getAll(n: string): FormDataEntryValue[];
}): { ok: true; reglage: ReglagePerimetre } | { ok: false; raison: string } {
  const connus = new Set(domainesDuVocabulaire());
  const domaines = fd.getAll("domaine").filter((d): d is string => typeof d === "string");
  for (const d of domaines) if (!connus.has(d)) return { ok: false, raison: `domaine inconnu : ${d}` };

  const brut = fd.get("niveauMax");
  // ⚠️ `Number("")` vaut ZÉRO, et zéro est un niveau valide : sans cette garde, un champ
  // ABSENT serait lu comme « niveau 0 » — le plus restrictif, donc sans dégât, mais
  // silencieux. Un réglage qu'on n'a pas fait ne doit pas s'écrire comme un réglage fait.
  const niveauMax = typeof brut === "string" && brut.trim() !== "" ? Number(brut) : NaN;
  if (!Number.isInteger(niveauMax) || niveauMax < 0 || niveauMax > 3) {
    return { ok: false, raison: "niveau maximal : un entier de 0 à 3" };
  }
  // ⚠️ Le niveau 3 n'a AUCUNE valeur stockée (ADR 0001 §5.3) : l'accorder ne sert à rien et
  // laisserait croire qu'une app peut lire un document d'identité. On refuse plutôt que de
  // laisser un réglage mensonger dans l'interface.
  if (niveauMax === 3) return { ok: false, raison: "le niveau 3 n'a aucun contenu : il ne s'accorde pas" };

  const role = fd.get("role") === "ecriture" ? "ecriture" : "lecture";
  return {
    ok: true,
    reglage: {
      domaines: [...new Set(domaines)].sort(),
      niveauMax,
      role,
      admetInvites: fd.get("admetInvites") === "on",
      // Le domicile n'est servi que si le niveau le permet AUSSI : cocher la case sans monter
      // le niveau ne doit pas ouvrir la porte à moitié.
      domicile: fd.get("domicile") === "on" && niveauMax >= 2,
    },
  };
}

export function depotPerimetresDrizzle(db: Base): DepotPerimetres {
  return {
    async tous() {
      return db.select().from(schema.perimetres).orderBy(schema.perimetres.appId);
    },
    async parApp(appId) {
      const rows = await db.select().from(schema.perimetres).where(eq(schema.perimetres.appId, appId)).limit(1);
      return rows[0] ?? null;
    },
    async regler(appId, r, maintenant) {
      const valeurs = {
        appId,
        domaines: JSON.stringify(r.domaines),
        niveauMax: r.niveauMax,
        role: r.role,
        admetInvites: r.admetInvites,
        domicile: r.domicile,
        modifieLe: maintenant,
      };
      await db.insert(schema.perimetres).values(valeurs).onConflictDoUpdate({
        target: schema.perimetres.appId,
        set: valeurs,
      });
    },
    async retirer(appId) {
      await db.delete(schema.perimetres).where(eq(schema.perimetres.appId, appId));
    },
  };
}
