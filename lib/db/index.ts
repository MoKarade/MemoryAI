// lib/db/index.ts — connexion Neon (driver HTTP serverless), patron CarAI.
//
// Initialisation PARESSEUSE : le module s'importe au build sans DATABASE_URL ; l'erreur
// honnête ne part qu'à la PREMIÈRE requête réelle. Les tests n'importent pas ce module :
// ils bâtissent leur propre Postgres en mémoire (PGlite) sur les migrations committées.

import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Env = Record<string, string | undefined>;

let instance: NeonHttpDatabase<typeof schema> | null = null;

function connect(): NeonHttpDatabase<typeof schema> {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL manquant : configure la base Neon (voir .env.example).");
  }
  instance = drizzle(neon(url), { schema });
  return instance;
}

/** true si la base est configurée. Pour afficher un état HONNÊTE, jamais pour cacher une panne. */
export function baseConfiguree(env: Env = process.env): boolean {
  return Boolean(env.DATABASE_URL?.trim());
}

/** Proxy paresseux : `db.select()…` s'utilise partout, la connexion se fait au 1ᵉʳ usage. */
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(connect(), prop, receiver);
  },
});

export { schema };
