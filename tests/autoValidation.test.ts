// tests/autoValidation.test.ts — la règle d'auto-validation (ADR 0003), sur ses deux
// surfaces : la décision PURE, le flux d'écriture, et le RATTRAPAGE du stock déjà en base.
//
// ⚠️ Les trois doivent dire la MÊME chose. La règle vit dans `COUPLES_MECANIQUES` ; le
// rattrapage est du SQL, donc une SECONDE écriture de la même règle — c'est le tripwire
// « chaque couple est couvert par une migration » qui empêche les deux de diverger, et il
// force un couple NOUVEAU à recevoir sa PROPRE migration (on ne réécrit jamais un fichier
// déjà appliqué : son empreinte le ferait rejouer).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotDrizzle } from "../lib/depotFaits";
import { ecrireLot } from "../lib/ecrireFaits";
import { COUPLES_MECANIQUES, estMecanique, statutInitial } from "../lib/autoValidation";
import type { Ecrivain } from "../lib/jetons";

const MOTEUR = { extracteur: "moteur-inventaire-v1" };
const base = { predicat: "document.existe", canari: false, provenance: MOTEUR };

describe("la règle PURE", () => {
  it("un couple déclaré est mécanique, donc valide d'emblée", () => {
    expect(estMecanique(base)).toBe(true);
    expect(statutInitial(base)).toBe("valide");
  });

  it("un CANARI ne s'auto-valide jamais, quelle que soit sa provenance", () => {
    expect(estMecanique({ ...base, canari: true })).toBe(false);
    expect(statutInitial({ ...base, canari: true })).toBe("propose");
  });

  it("le MÊME prédicat par un AUTRE extracteur reste à valider", () => {
    // C'est le sens de la règle : elle porte sur la PROVENANCE, jamais sur le contenu.
    expect(statutInitial({ ...base, provenance: { extracteur: "conversation-v1" } })).toBe("propose");
  });

  it("le MÊME extracteur sur un AUTRE prédicat reste à valider", () => {
    expect(statutInitial({ ...base, predicat: "emploi.employeur" })).toBe("propose");
  });
});

describe("le rattrapage couvre exactement la règle", () => {
  const sql = readdirSync(resolve(process.cwd(), "drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(resolve(process.cwd(), "drizzle", f), "utf8"))
    .join("\n");

  it("CHAQUE couple mécanique est rattrapé par une migration", () => {
    // Ajouter un couple sans sa migration laisserait son stock à `propose` pour toujours :
    // le flux ne regarde jamais en arrière. Ce test oblige à écrire la migration.
    const nonCouverts = COUPLES_MECANIQUES.filter(
      (c) => !new RegExp(`"extracteur"\\s*=\\s*'${c.extracteur}'[\\s\\S]{0,200}?'${c.predicat}'`).test(sql),
    );
    expect(nonCouverts).toEqual([]);
    // Anti-vacuité : le motif ne trouve pas un couple qui n'existe pas.
    expect(/"extracteur"\s*=\s*'extracteur-fantome'/.test(sql)).toBe(false);
  });

  it("le rattrapage porte ses trois gardes", () => {
    const rattrapage = sql.slice(sql.indexOf("UPDATE \"faits\""));
    expect(rattrapage).toMatch(/"statut"\s*=\s*'propose'/); // un REJET n'est pas re-validé
    expect(rattrapage).toMatch(/"canari"\s*=\s*false/); // un canari ne s'auto-valide jamais
    expect(rattrapage).toMatch(/"supprime_le"\s+IS NULL/); // un fait oublié ne revient pas
  });
});

describe("le flux et le rattrapage, sur une VRAIE Postgres", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const cle = deriverCle(randomBytes(32).toString("base64"));
  const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };
  const LE_MIGRATEUR = new Date("2026-09-16T18:00:00.000Z");

  const fichiers = () =>
    readdirSync(resolve(process.cwd(), "drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .sort();

  const jouer = async (fs: readonly string[]) => {
    for (const f of fs) {
      for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
        if (s.trim()) await pg.exec(s);
      }
    }
  };

  const fait = (ref: string, extra: Record<string, unknown> = {}) => ({
    sujet: "marc",
    predicat: "document.existe",
    valeur: "1AbCdEfGhIjKlMnOp",
    valeur_type: "ref_document",
    provenance: { source_type: "document", source_ref: ref, extracteur: "moteur-inventaire-v1" },
    ...extra,
  });

  beforeAll(async () => {
    pg = new PGlite();
    // On joue TOUT sauf le rattrapage : on veut d'abord le stock d'AVANT.
    await jouer(fichiers().filter((f) => !f.startsWith("0007_")));
    db = drizzle(pg, { schema });
  });

  afterAll(async () => {
    await pg?.close();
  });

  it("le flux valide d'emblée un fait mécanique, et pose sa date", async () => {
    const quand = new Date("2026-09-16T17:00:00.000Z");
    const r = await ecrireLot([fait("flux-mecanique")], DRIVEAI, cle, depotDrizzle(db), quand);
    expect(r.acceptes).toBe(1);
    const [f] = await db.select().from(schema.faits).where(eq(schema.faits.id, r.idsCrees[0]!));
    expect(f!.statut).toBe("valide");
    // Sans `valide_le`, le `dataAsOf` du hub retombe à NULL (tri DESC = NULLS FIRST).
    expect(f!.valideLe?.toISOString()).toBe(quand.toISOString());
  });

  it("le flux laisse à valider ce qu'un modèle a déduit", async () => {
    const r = await ecrireLot(
      [fait("flux-deduit", { predicat: "emploi.employeur", valeur: "Entreprise Exemple", valeur_type: "texte" })],
      DRIVEAI,
      cle,
      depotDrizzle(db),
    );
    const [f] = await db.select().from(schema.faits).where(eq(schema.faits.id, r.idsCrees[0]!));
    expect(f!.statut).toBe("propose");
    expect(f!.valideLe).toBeNull();
  });

  it("le rattrapage prend le stock mécanique et LAISSE tout le reste", async () => {
    // Le stock d'avant : quatre faits, dont trois que le rattrapage ne doit PAS toucher.
    const stock = [
      fait("stock-mecanique"),
      fait("stock-rejete"),
      fait("stock-autre-predicat", { predicat: "emploi.employeur", valeur: "Entreprise Exemple", valeur_type: "texte" }),
      fait("stock-autre-extracteur", {
        provenance: { source_type: "document", source_ref: "stock-autre-extracteur", extracteur: "conversation-v1" },
      }),
    ];
    const r = await ecrireLot(stock, DRIVEAI, cle, depotDrizzle(db), LE_MIGRATEUR);
    expect(r.acceptes).toBe(4);
    // Deux d'entre eux viennent d'être écrits par le flux CORRIGÉ : on remet TOUT à l'état
    // d'AVANT, sinon le rattrapage n'aurait rien à rattraper et le test serait vide.
    await pg.exec(`UPDATE "faits" SET "statut" = 'propose', "valide_le" = NULL`);
    // Puis le cas que seule Marc produit, et qu'aucun flux ne peut fabriquer : un REJET.
    await pg.exec(`UPDATE "faits" SET "statut" = 'rejete' WHERE "id" = '${r.idsCrees[1]!}'`);

    const avant = await db.select().from(schema.faits);
    expect(avant.filter((f) => f.statut === "propose").length).toBeGreaterThan(0);

    await jouer(["0007_auto_validation_mecanique.sql"]);

    const apres = await db.select().from(schema.faits);
    const parRef = new Map<string, (typeof apres)[number]>();
    for (const f of apres) {
      const [p] = await db.select().from(schema.provenances).where(eq(schema.provenances.faitId, f.id));
      parRef.set(p!.sourceRef, f);
    }
    // Rattrapés : les mécaniques encore `propose`.
    expect(parRef.get("stock-mecanique")!.statut).toBe("valide");
    expect(parRef.get("stock-mecanique")!.valideLe).not.toBeNull();
    expect(parRef.get("flux-mecanique")!.statut).toBe("valide");
    // Intouchés : un autre prédicat, un autre extracteur, et le REJET de Marc.
    expect(parRef.get("stock-autre-predicat")!.statut).toBe("propose");
    expect(parRef.get("stock-autre-extracteur")!.statut).toBe("propose");
    expect(parRef.get("flux-deduit")!.statut).toBe("propose");
    expect(parRef.get("stock-rejete")!.statut).toBe("rejete");
  });
});
