// tests/pile.test.ts — la pile « vrai / faux » sur une VRAIE Postgres (PGlite), ADR 0012.
//
// Ce qui est prouvé :
//  1. un avis ne modifie AUCUNE pièce ; la remarque d'un « faux » est chiffrée en base ;
//  2. la pile ne propose que des papiers LUS et vivants ;
//  3. un papier contesté reste SERVI au chat, marqué `avis_marc="conteste"` — et changer d'avis
//     (vrai après faux) le re-marque, sans rien effacer ;
//  4. le MCP n'y gagne aucun contenu ;
//  5. les listes fermées du code et de la base disent la même chose.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotPiecesDrizzle } from "../lib/pieces/depot";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";
import { ecrireLotPieces } from "../lib/pieces/ecrire";
import { EXTRACTEUR_MIGRATION } from "../lib/pieces/migration";
import { outilParNom, type ContexteOutils } from "../lib/mcp/outils";
import { depotPileDrizzle } from "../lib/pile/depot";
import { composerPile, GENRES_CARTE, VERDICTS } from "../lib/pile/composer";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(Buffer.alloc(32, 5).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };
const NUMERO = ["QZ", "40", "18", "77"].join("");
const REMARQUE = `le numéro est ${NUMERO}, pas autre chose`;
const MAINTENANT = new Date("2026-09-24T22:30:00Z");

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let idPasseport = "";
let idBail = "";
let idInventaire = "";

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) if (s.trim()) await pg.exec(s);
  }
  db = drizzle(pg, { schema });
  const base = { extracteur: "haiku-4.5-piece-v1" };
  const r = await ecrireLotPieces(
    [
      {
        ...base,
        type: "passeport",
        emetteur: "République Exemple",
        titulaire: "Jean Exemple",
        titulaire_confiance: 0.6,
        annee: 2019,
        domaine: "04 · Immigration",
        date_document: "2020-03-18",
        date_echeance: "2030-03-17",
        resume: "Passeport.",
        champs_structures: { numeros: [{ libelle: "numéro de passeport", valeur: NUMERO }] },
        exemplaires: [{ file_id: "fid-pass", chemin: "/04 · Immigration/Passeport" }],
      },
      { ...base, type: "bail", emetteur: "Gestion Exemple", annee: 2026, domaine: "05 · Carrière", resume: "Bail.", exemplaires: [{ file_id: "fid-bail", chemin: "/05/Bail" }] },
      { ...base, type: "facture", emetteur: "Hydro", annee: 2026, domaine: "02 · Finances", resume: "Facture.", exemplaires: [{ file_id: "fid-inv", chemin: "/02/Facture" }] },
    ],
    DRIVEAI,
    cle,
    depotPiecesDrizzle(db),
  );
  expect(r.acceptees, JSON.stringify(r)).toBe(3);
  const rows = await db.select({ id: schema.pieces.id, type: schema.pieces.typeCle, domaine: schema.pieces.domaine }).from(schema.pieces);
  idPasseport = rows.find((x) => x.domaine?.startsWith("04"))!.id;
  idBail = rows.find((x) => x.domaine?.startsWith("05"))!.id;
  idInventaire = rows.find((x) => x.domaine?.startsWith("02"))!.id;
  // Un papier de l'INVENTAIRE (jamais ouvert) : il n'y a rien à juger.
  await db.update(schema.pieces).set({ extracteur: EXTRACTEUR_MIGRATION }).where(eq(schema.pieces.id, idInventaire));
});
afterAll(async () => pg?.close());

const ctx = (lecteur: string) =>
  ({
    pieces: depotPiecesLectureDrizzle(db),
    cle,
    env: { MEMORYAI_N3_CHAT: "1" },
    lecteur,
    maintenant: () => MAINTENANT,
  }) as unknown as ContexteOutils;

describe("la pile ne propose que des papiers LUS et vivants", () => {
  it("l'inventaire n'y est pas ; le titulaire incertain passe en tête", async () => {
    const candidats = await depotPileDrizzle(db).candidatsPieces();
    const ids = candidats.map((c) => c.id);
    expect(ids).toContain(idPasseport);
    expect(ids).toContain(idBail);
    expect(ids).not.toContain(idInventaire);
    const pile = composerPile({ pieces: candidats, faits: [], questions: [], avis: [], aujourdhui: "2026-09-24" });
    expect(pile[0]).toEqual({ genre: "piece", id: idPasseport });
  });
});

describe("un avis se lit À CÔTÉ : il ne touche à aucune pièce", () => {
  it("« faux » avec remarque : la pièce est identique octet pour octet, la remarque est chiffrée", async () => {
    const avant = await db.select().from(schema.pieces).where(eq(schema.pieces.id, idPasseport));
    const depot = depotPileDrizzle(db);
    await depot.consigner({ genre: "piece", refId: idPasseport, verdict: "faux", remarque: REMARQUE }, cle, MAINTENANT);
    const apres = await db.select().from(schema.pieces).where(eq(schema.pieces.id, idPasseport));
    expect(apres).toEqual(avant);

    const brutes = await db.select().from(schema.avisPile).where(eq(schema.avisPile.refId, idPasseport));
    expect(brutes).toHaveLength(1);
    expect(brutes[0]!.remarque).not.toContain(NUMERO);
    expect(await depot.remarque("piece", idPasseport, cle)).toBe(REMARQUE);
  });

  it("le papier jugé sort de la pile ; le non jugé y reste", async () => {
    const depot = depotPileDrizzle(db);
    const pile = composerPile({ pieces: await depot.candidatsPieces(), faits: [], questions: [], avis: await depot.avis(), aujourdhui: "2026-09-24" });
    expect(pile.map((c) => c.id)).toEqual([idBail]);
  });

  it("la base refuse une remarque sur un « vrai » — le contrat n'est pas le seul chemin d'écriture", async () => {
    await expect(db.insert(schema.avisPile).values({ genre: "piece", refId: idBail, verdict: "vrai", remarque: "x" })).rejects.toThrow();
  });
});

describe("le chat reçoit l'avis de Marc ; le MCP n'y gagne aucun contenu", () => {
  it("un papier contesté reste SERVI au chat, marqué conteste", async () => {
    const r = await outilParNom("memoryai_papiers_chercher")!.executer({ question: "passeport", inclure_n3: true }, ctx("chat"));
    expect(r.texte).toContain(`<piece id="${idPasseport}"`);
    expect(r.texte).toContain('avis_marc="conteste"');
    // Contesté ne veut pas dire retiré (arbitrage de Marc) : le contenu est toujours là.
    expect(r.texte).toContain(NUMERO);
    // La remarque, elle, ne part JAMAIS vers un modèle : elle n'est lue que par Marc.
    expect(r.texte).not.toContain("pas autre chose");
  });

  it("changer d'avis re-marque le papier, sans rien effacer", async () => {
    await depotPileDrizzle(db).consigner({ genre: "piece", refId: idPasseport, verdict: "vrai" }, cle, new Date("2026-09-24T23:00:00Z"));
    const r = await outilParNom("memoryai_papiers_chercher")!.executer({ question: "passeport", inclure_n3: true }, ctx("chat"));
    expect(r.texte).toContain('avis_marc="confirme"');
    expect(await db.select().from(schema.avisPile).where(eq(schema.avisPile.refId, idPasseport))).toHaveLength(2);
  });

  it("au MCP, le papier N3 reste un sommaire sans numéro, avis ou pas", async () => {
    const r = await outilParNom("memoryai_papiers_chercher")!.executer({ domaines: ["04 · Immigration"], inclure_n3: true }, ctx("claude-ai"));
    expect(r.texte).toContain('forme="sommaire"');
    expect(r.texte).not.toContain(NUMERO);
  });

  it("l'en-tête des papiers dit au modèle ce qu'est un papier contesté", async () => {
    const r = await outilParNom("memoryai_papiers_chercher")!.executer({ question: "passeport", inclure_n3: true }, ctx("chat"));
    expect(r.texte).toMatch(/avis_marc=\\?"conteste\\?".*ne présente jamais son contenu comme sûr/);
  });
});

describe("les listes fermées du code et de la base disent la même chose", () => {
  it("genres et verdicts", () => {
    expect([...GENRES_CARTE]).toEqual([...schema.GENRES_AVIS]);
    expect([...VERDICTS]).toEqual([...schema.VERDICTS_AVIS]);
    const sql = readFileSync(resolve(process.cwd(), "drizzle/0018_avis_pile.sql"), "utf8");
    for (const g of GENRES_CARTE) expect(sql).toContain(`'${g}'`);
    for (const v of VERDICTS) expect(sql).toContain(`'${v}'`);
  });
});
