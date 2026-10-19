// tests/migrationsProd.test.ts — les migrations s'appliquent COMME EN PRODUCTION.
//
// ⚠️ CE FICHIER EXISTE PARCE QUE TOUTE LA SUITE ÉTAIT VERTE PENDANT QUE LA PRODUCTION RENDAIT
// « erreur de base de données » SUR CHAQUE PAGE (16/09 au soir). Deux causes empilées, et
// aucune des deux ne pouvait être vue par les tests existants :
//
//   1. `0011` et `0012` portaient PLUSIEURS commandes SQL sans `--> statement-breakpoint`.
//      Drizzle découpe sur ce marqueur et envoie chaque morceau en UNE requête ; le pilote
//      HTTP de Neon refuse alors « cannot insert multiple commands into a prepared statement ».
//      Les autres tests appliquaient par `pg.exec()`, qui ACCEPTE le multi-commandes (mesuré) :
//      ils validaient un contrat que la production n'a pas.
//
//   2. `0010` n'était pas idempotent. Or le migrator `neon-http` accumule ses `insert` dans
//      `__drizzle_migrations` et ne les exécute QU'À LA FIN (lu dans son code) : une migration
//      qui échoue plus loin dans la file laisse les précédentes appliquées et NON enregistrées.
//      Elles se rejouent au prochain appel, échouent sur « already exists », et la base reste
//      bloquée pour toujours — un rattrapage impossible, pas un blip.
//
// Les deux propriétés se tiennent donc ici, sur une VRAIE Postgres, avec l'instrument juste :
// `pg.query()`, qui rend le MÊME refus que Neon HTTP sur le multi-commandes.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const DOSSIER = resolve(process.cwd(), "drizzle");

function fichiers(): string[] {
  return readdirSync(DOSSIER)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Ce que Drizzle envoie à la base : un morceau par `--> statement-breakpoint`, tel quel. */
function morceaux(fichier: string): string[] {
  return readFileSync(resolve(DOSSIER, fichier), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * LES MIGRATIONS HISTORIQUES QUI NE SONT PAS IDEMPOTENTES — un inventaire, pas une permission.
 *
 * Ces neuf-là sont DÉJÀ enregistrées dans `__drizzle_migrations` en production (mesuré le
 * 16/09 : le rejeu commençait à `0010`, donc `0009` était la dernière inscrite). Elles ne se
 * rejoueront jamais, et sur une base neuve elles ne passent qu'une fois. Les réécrire
 * changerait des fichiers appliqués pour un risque qui n'existe plus.
 *
 * ⚠️ CETTE LISTE NE PEUT QUE RÉTRÉCIR. Toute migration AJOUTÉE après le 16/09 doit être
 * idempotente — elle, elle peut se rejouer, et c'est exactement ce qui a bloqué la base.
 * Le test plus bas échoue si un nom s'y ajoute, et il échoue AUSSI si un nom y reste alors
 * que le fichier est devenu idempotent : un inventaire de dette doit savoir mourir.
 */
const NON_IDEMPOTENTES_HISTORIQUES = [
  "0000_memoire-initiale.sql",
  "0001_journal-chaine-unique.sql",
  "0002_depenses-chat.sql",
  "0003_questions.sql",
  "0004_conversations.sql",
  "0005_extraction.sql",
  "0006_liens.sql",
  "0008_postes_de_depense.sql",
  "0009_pieces.sql",
];

let pg: PGlite;

beforeEach(async () => {
  pg = new PGlite();
});

afterEach(async () => {
  await pg?.close();
});

/** Le chemin de la PRODUCTION : une commande par requête, jamais `exec()`. */
async function appliquerCommeEnProd(): Promise<void> {
  for (const f of fichiers()) {
    for (const m of morceaux(f)) {
      try {
        await pg.query(m);
      } catch (err) {
        throw new Error(`${f} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

describe("les migrations, appliquées comme en production", () => {
  it("chaque morceau est UNE seule commande — le pilote de Neon refuse les autres", async () => {
    await expect(appliquerCommeEnProd()).resolves.toBeUndefined();
  }, 120_000);

  // ⚠️ LA PROPRIÉTÉ QUI A MANQUÉ. Rejouer n'est pas un cas tordu : c'est ce qui arrive
  // MÉCANIQUEMENT dès qu'une migration plus loin dans la file échoue, puisque rien n'est
  // enregistré tant que tout n'a pas passé. Un fichier non idempotent est donc un fichier
  // qui, le jour où un VOISIN casse, bloque la base définitivement.
  it("une migration NEUVE se rejoue sans lever, et l'inventaire des anciennes est EXACT", async () => {
    await appliquerCommeEnProd();

    const rejouables: string[] = [];
    for (const f of fichiers()) {
      let leve = false;
      for (const m of morceaux(f)) {
        try {
          await pg.query(m);
        } catch {
          leve = true;
          break;
        }
      }
      if (!leve) rejouables.push(f);
    }

    const attendues = fichiers().filter((f) => !NON_IDEMPOTENTES_HISTORIQUES.includes(f));
    // Dans les DEUX sens : une neuve non idempotente fait échouer (elle manque à `rejouables`),
    // et une historique devenue idempotente aussi (elle est de trop) — retire-la de la liste.
    expect(rejouables.sort()).toEqual(attendues.sort());
  }, 120_000);

  // L'anti-vacuité : si le découpage ne rendait qu'un morceau par fichier, ou zéro, les deux
  // cas ci-dessus pourraient passer sans rien exercer.
  it("le découpage rend bien des commandes à exécuter", () => {
    const total = fichiers().reduce((n, f) => n + morceaux(f).length, 0);
    expect(fichiers().length).toBeGreaterThanOrEqual(13);
    expect(total).toBeGreaterThan(fichiers().length);
  });
});
