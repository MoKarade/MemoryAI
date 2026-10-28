// tests/sensProche.test.ts — les liens DEVINÉS (tâche MemoryAI 186, partie B). Données FICTIVES ;
// les vecteurs sont posés à la main, le vrai modèle ne tourne jamais en CI (≈ 280 Mo).
//
// Ce qui est prouvé : le seuil coupe, K voisins au plus, une paire réciproque ne fait qu'un lien,
// deux textes identiques ne se lient pas ici (les règles le font déjà), le `pourquoi` ne cite
// jamais un texte, et le recalcul en base ne touche qu'aux liens `modele`.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotDrizzle } from "../lib/depotFaits";
import { depotLiensDrizzle } from "../lib/depotLiens";
import { ecrireLot } from "../lib/ecrireFaits";
import type { FaitPourGraphe } from "../lib/graphe";
import type { Ecrivain } from "../lib/jetons";
import { FAITS_MAX_SENS, liensDeSens, SEUIL_SENS, texteAPlonger, VOISINS_MAX, type Plonge } from "../lib/sensProche";

/** Un vecteur normé de dimension 2 à l'angle donné : le cosinus de deux d'entre eux est cos(Δ). */
const angle = (deg: number): number[] => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const p = (id: string, deg: number, texte = `texte ${id}`): Plonge => ({ id, texte, vecteur: angle(deg) });

describe("liensDeSens (PUR)", () => {
  it("relie au-dessus du seuil, jamais en dessous", () => {
    const { liens } = liensDeSens([p("a", 0), p("b", 30), p("c", 120)]);
    expect(Math.cos(Math.PI / 6)).toBeGreaterThan(SEUIL_SENS);
    expect(liens.map((l) => [l.faitA, l.faitB])).toEqual([["a", "b"]]);
    expect(liens[0]).toMatchObject({ type: "sens-proche", cibleB: "fait", regle: "sens-proche-v1", poids: 0.87 });
  });

  it("le pourquoi dit la ressemblance, jamais le texte comparé", () => {
    const { liens } = liensDeSens([p("a", 0, "allergie fictive"), p("b", 10, "aliment évité fictif")]);
    expect(liens[0]!.pourquoi).toBe("Sens proche, deviné par un petit modèle (ressemblance 98 %).");
    expect(liens[0]!.pourquoi).not.toMatch(/fictif|allergie|aliment/);
  });

  it("au plus K voisins par fait, les plus proches d'abord", () => {
    const voisins = Array.from({ length: VOISINS_MAX + 3 }, (_, i) => p(`v${i}`, 120 + i * 1));
    const { liens } = liensDeSens([p("centre", 120.5), ...voisins]);
    const duCentre = liens.filter((l) => l.faitA === "centre" || l.faitB === "centre");
    // Le centre garde ses K plus proches ; d'autres liens peuvent l'atteindre par LEUR choix.
    expect(duCentre.length).toBeGreaterThanOrEqual(VOISINS_MAX);
    expect(liens.every((l) => l.faitA < l.faitB)).toBe(true);
    expect(new Set(liens.map((l) => `${l.faitA}|${l.faitB}`)).size).toBe(liens.length);
  });

  it("deux textes identiques ne se lient pas ici, et l'écart est compté", () => {
    const { liens, abstentions } = liensDeSens([p("a", 0, "même texte"), p("b", 0, "même texte")]);
    expect(liens).toEqual([]);
    expect(abstentions).toEqual([{ regle: "sens-proche", motif: "textes identiques, déjà liés par les règles", taille: 1 }]);
  });

  it("au-delà de la borne, abstention dite plutôt qu'une passe sans fin", () => {
    const trop = Array.from({ length: FAITS_MAX_SENS + 1 }, (_, i) => p(`f${i}`, 0));
    const { liens, abstentions } = liensDeSens(trop);
    expect(liens).toEqual([]);
    expect(abstentions[0]).toMatchObject({ regle: "sens-proche", taille: FAITS_MAX_SENS + 1 });
  });

  it("déterministe : l'ordre d'entrée ne change rien", () => {
    const items = [p("a", 0), p("b", 20), p("c", 35), p("d", 50)];
    expect(liensDeSens([...items].reverse())).toEqual(liensDeSens(items));
  });
});

describe("texteAPlonger", () => {
  const f = (x: Partial<FaitPourGraphe>): FaitPourGraphe => ({
    id: "x", domaine: "gout", predicat: "gout.musique", valeurType: "texte", valeur: "jazz",
    attributs: null, valideDe: null, valideA: null, remplaceId: null, ...x,
  });
  it("un texte porte sa description ; un document, son type et son émetteur ; une date, rien", () => {
    expect(texteAPlonger(f({}), "Un genre musical aimé")).toBe("Un genre musical aimé : jazz");
    expect(texteAPlonger(f({ valeurType: "ref_document", valeur: "1Fictif", attributs: { type: "facture", emetteur: "Fournisseur Fictif" } }), null)).toBe("facture Fournisseur Fictif");
    expect(texteAPlonger(f({ valeurType: "ref_document", valeur: "1Fictif" }), null)).toBeNull();
    expect(texteAPlonger(f({ valeurType: "date", valeur: "2026-01-01" }), "Une date")).toBeNull();
  });
});

describe("recalculerSens, sur une VRAIE Postgres", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const cle = deriverCle(Buffer.alloc(32, 5).toString("base64"));
  const APP: Ecrivain = { appId: "essai", role: "ecriture", fiabilites: ["app"] };
  let ids: string[] = [];

  beforeAll(async () => {
    pg = new PGlite();
    for (const fichier of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
      for (const s of readFileSync(resolve(process.cwd(), "drizzle", fichier), "utf8").split("--> statement-breakpoint")) {
        if (s.trim()) await pg.exec(s);
      }
    }
    db = drizzle(pg, { schema });
    const r = await ecrireLot(
      ["jazz fictif", "blues fictif", "course fictive"].map((valeur, i) => ({
        sujet: "marc",
        predicat: "gout.musique",
        valeur,
        valeur_type: "texte",
        provenance: { source_type: "app", source_ref: `essai-${i}`, extracteur: "essai" },
      })),
      APP,
      cle,
      depotDrizzle(db),
    );
    ids = r.idsCrees;
    expect(ids).toHaveLength(3);
  });

  afterAll(async () => {
    await pg?.close();
  });

  it("écrit des liens `modele`, et laisse ceux des règles", async () => {
    await db.insert(schema.liens).values({
      id: randomUUID(), faitA: ids[0]!, faitB: ids[2]!, cibleB: "fait", type: "meme-source",
      poids: 0.9, origine: "regle", regle: "meme-source", pourquoi: "fictif",
    });
    await db.insert(schema.liens).values({
      id: randomUUID(), faitA: ids[0]!, faitB: ids[1]!, cibleB: "fait", type: "lie-par-lia",
      poids: 0.5, origine: "modele", regle: "lia-lie-v1", pourquoi: "Rapproché par LIA : fictif.",
    });
    // Un plongeur factice : les deux musiques proches, la course loin.
    const plongeur = async (textes: readonly string[]) => textes.map((t) => angle(t.includes("course") ? 90 : t.includes("blues") ? 10 : 0));
    const r = await depotLiensDrizzle(db).recalculerSens(cle, new Date("2026-10-26T12:00:00Z"), plongeur);
    expect(r).toMatchObject({ faitsLus: 3, illisibles: 0, liensEcrits: 1 });
    const modele = await db.select().from(schema.liens).where(eq(schema.liens.origine, "modele"));
    expect(modele).toHaveLength(2);
    expect(modele.map((lien) => lien.type).sort()).toEqual(["lie-par-lia", "sens-proche"]);
    expect(await db.select().from(schema.liens).where(eq(schema.liens.origine, "regle"))).toHaveLength(1);
  });

  it("un modèle en panne lève AVANT de supprimer : les liens devinés d'hier restent", async () => {
    const enPanne = async () => {
      throw new Error("téléchargement impossible");
    };
    await expect(depotLiensDrizzle(db).recalculerSens(cle, new Date(), enPanne)).rejects.toThrow("téléchargement impossible");
    const modele = await db.select().from(schema.liens).where(eq(schema.liens.origine, "modele"));
    expect(modele).toHaveLength(2);
    expect(modele.some((lien) => lien.type === "lie-par-lia")).toBe(true);
  });
});
