// lib/pageDonnees.ts — ce que les pages privées partagent : la base et la clé, ou un état
// HONNÊTE quand l'une des deux manque. Une page sans base ne ressemble pas à une panne ;
// elle dit ce qui manque.

import { cleDepuisEnv, ClefAbsenteError, type Cle } from "./chiffrement";
import { baseConfiguree, db } from "./db";
import { assurerMigrations } from "./migrations";

export type Acces = { ok: true; cle: Cle; db: typeof db } | { ok: false; manque: "base" | "cle" };

export async function accesDonnees(): Promise<Acces> {
  if (!baseConfiguree()) return { ok: false, manque: "base" };
  let cle: Cle;
  try {
    cle = cleDepuisEnv();
  } catch (err) {
    if (err instanceof ClefAbsenteError) return { ok: false, manque: "cle" };
    throw err;
  }
  await assurerMigrations();
  return { ok: true, cle, db };
}

export const MESSAGES_MANQUE = {
  base: "Aucune base branchée (DATABASE_URL manquante). Rien n'est stocké, rien n'est perdu : voir HANDOVER.md.",
  cle: "La clé de chiffrement (MEMORYAI_CHIFFREMENT) manque : rien n'est lisible ni écrit. C'est un kill-switch, pas une panne.",
} as const;
