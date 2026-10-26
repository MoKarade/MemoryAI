// tests/deductionPasse.test.ts — la passe de l'âge déduit (ADR 0023, tâche MemoryAI 185), sur une
// VRAIE Postgres. Données FICTIVES : noms, dates et identifiants inventés.
//
// Ce qui est prouvé : la date vient des papiers de MARC (pas d'un proche), l'âge s'écrit chiffré
// au niveau du vocabulaire et validé, la même passe le même jour n'écrit rien, le jour
// anniversaire périme l'ancien âge, et une absence de nom ou une contradiction donne une
// abstention nommée, jamais un âge.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { chiffrer, dechiffrer, deriverCle } from "../lib/chiffrement";
import { depotAdminDrizzle } from "../lib/depotAdmin";
import { depotDrizzle } from "../lib/depotFaits";
import { passeDeduction, PREDICAT_AGE, sourcesDeduction } from "../lib/deductionPasse";
import { NIVEAU_MESSAGE } from "../lib/evenements/depot";
import { depotPiecesDrizzle } from "../lib/pieces/depot";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";
import { ecrireLotPieces } from "../lib/pieces/ecrire";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(Buffer.alloc(32, 9).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const papier = (fileId: string, titulaire: string, naissance: string) => ({
  type: "passeport",
  emetteur: "Pays Fictif",
  annee: 2024,
  domaine: "04 · Immigration",
  titulaire,
  titulaire_confiance: 0.95,
  champs_libres: { "date de naissance": naissance },
  exemplaires: [{ file_id: fileId, chemin: "/04 · Immigration/Passeport" }],
  extracteur: "haiku-4.5-piece-v1",
});

const passe = (quand: string) =>
  passeDeduction({
    sources: sourcesDeduction(db, depotPiecesLectureDrizzle(db), cle),
    faits: depotDrizzle(db),
    admin: depotAdminDrizzle(db),
    cle,
    // Midi au Québec : le jour de Marc, quel que soit le fuseau du serveur.
    maintenant: new Date(`${quand}T16:00:00Z`),
  });

const ages = () => db.select().from(schema.faits).where(eq(schema.faits.predicat, PREDICAT_AGE));

async function ajouterPersonne(id: string, nom: string, estMarc: boolean) {
  await db.insert(schema.personnes).values({ id, nom: chiffrer(cle, nom, `personne|${id}`, NIVEAU_MESSAGE), estMarc });
}

beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
  const r = await ecrireLotPieces(
    // Le passeport de Marc, nom de famille d'abord ; celui d'un proche, qui ne doit pas compter.
    [papier("fid-marc", "FICTIF, Nom", "1990-03-14"), papier("fid-proche", "Proche Fictif", "1960-01-01")],
    DRIVEAI,
    cle,
    depotPiecesDrizzle(db),
  );
  expect(r).toMatchObject({ acceptees: 2 });
});

afterAll(async () => {
  await pg?.close();
});

describe("la passe de l'âge", () => {
  it("sans nom de Marc connu : abstention nommée, aucun fait", async () => {
    await ajouterPersonne("p-proche", "Proche Fictif", false);
    expect(await passe("2026-10-26")).toEqual({ fin: "aucun-nom", papiers: 0 });
    expect(await ages()).toHaveLength(0);
  });

  it("écrit l'âge depuis le papier de Marc : chiffré, au niveau du vocabulaire, validé, borné dans le temps", async () => {
    await ajouterPersonne("p-marc", "Nom Fictif", true);
    expect(await passe("2026-10-26")).toEqual({ fin: "ecrit", papiers: 1 });
    const [f] = await ages();
    expect(f!.niveau).toBe(1);
    expect(f!.statut).toBe("valide");
    expect(f!.valeur).not.toContain("ans");
    expect(dechiffrer(cle, f!.valeur!, f!.id, f!.niveau)).toBe("36 ans");
    expect([f!.valideDe, f!.valideA]).toEqual(["2026-03-14", "2027-03-13"]);
    const [prov] = await db.select().from(schema.provenances).where(eq(schema.provenances.faitId, f!.id));
    expect(prov!.sourceRef).toBe("fid-marc");
    expect(prov!.extracteur).toBe("deduction-v1");
  });

  it("la même passe le même jour n'écrit rien", async () => {
    expect(await passe("2026-10-26")).toEqual({ fin: "inchange", papiers: 1 });
    expect(await ages()).toHaveLength(1);
  });

  it("le jour anniversaire, le nouvel âge est validé et l'ancien devient périmé, jamais effacé", async () => {
    expect(await passe("2027-03-14")).toEqual({ fin: "ecrit", papiers: 1 });
    const valides = await db.select().from(schema.faits).where(and(eq(schema.faits.predicat, PREDICAT_AGE), eq(schema.faits.statut, "valide")));
    expect(valides).toHaveLength(1);
    expect(dechiffrer(cle, valides[0]!.valeur!, valides[0]!.id, 1)).toBe("37 ans");
    const perimes = await db.select().from(schema.faits).where(and(eq(schema.faits.predicat, PREDICAT_AGE), eq(schema.faits.statut, "perime")));
    expect(perimes).toHaveLength(1);
  });

  it("deux papiers de Marc qui se contredisent : abstention, et l'âge déjà écrit reste tel quel", async () => {
    const r = await ecrireLotPieces([papier("fid-marc-2", "Nom Fictif", "1990-03-15")], DRIVEAI, cle, depotPiecesDrizzle(db));
    expect(r).toMatchObject({ acceptees: 1 });
    expect(await passe("2027-03-20")).toEqual({ fin: "contradiction", papiers: 2 });
    expect(await ages()).toHaveLength(2);
  });
});
