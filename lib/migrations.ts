// lib/migrations.ts — appliquer les migrations sans jamais taper une commande.
//
// Exigence de Marc : il ne doit JAMAIS lancer une commande sur son PC. Patron JobAI/CarAI :
// migrations au DÉMARRAGE, mémorisées par processus, Drizzle arbitrant entre instances via
// `__drizzle_migrations`.
//
// ⚠️ APPELÉE PAR CHAQUE POINT D'ENTRÉE QUI TOUCHE LA BASE — pages, Server Actions, routes
// machine, MCP. Un chemin d'entrée qui oublie l'appel rend « 500 sans corps » sur une base
// neuve (leçon JobAI : les trois routes OAuth). `tests/migrations.test.ts` l'exige pour tout
// fichier qui importe `@/lib/db`.
//
// UN ÉCHEC NE DOIT PAS ÉTEINDRE L'APP, ET NE SE MÉMORISE PAS : mémoriser un succès est une
// optimisation, mémoriser un échec serait un verrou définitif (blip au démarrage à froid ⇒
// « schéma absent » à vie).

import { migrate } from "drizzle-orm/neon-http/migrator";
import { resolve } from "node:path";
import { baseConfiguree, db } from "./db";

let enCours: Promise<void> | null = null;
let derniereErreur: string | null = null;

/** Ce que la dernière tentative a donné — pour le diagnostic, jamais pour décider. */
export function etatMigrations(): { tentee: boolean; erreur: string | null } {
  return { tentee: enCours !== null, erreur: derniereErreur };
}

/** Oublie la mémorisation (tests). */
export function reinitialiserMigrations(): void {
  enCours = null;
  derniereErreur = null;
}

export async function assurerMigrations(): Promise<void> {
  if (!baseConfiguree()) return;
  if (enCours) return enCours;

  enCours = (async () => {
    try {
      await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
      derniereErreur = null;
    } catch (err) {
      derniereErreur = err instanceof Error ? err.message : String(err);
      console.error("[migrations] application impossible", err);
      enCours = null;
    }
  })();

  return enCours;
}
