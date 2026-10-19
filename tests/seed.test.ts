// tests/seed.test.ts — tout fichier de seed présent passe la VRAIE `validerFait`.
//
// Le seed du lot 6 est un fichier LOCAL (`seed/*.local.json`, hors git : des faits
// personnels). Ce test le prend s'il est là, et prend TOUJOURS `seed/exemple.json` — sinon
// « aucun fichier » rendrait la suite verte sans rien vérifier. Ce qu'il éprouve : chaque
// entrée, mise à la forme de la route par `scripts/seed.mjs`, est acceptée par `validerFait`
// avec les fiabilités du jeton `seed` ; aucune valeur ne ressemble à un montant (la route ne
// refuse que `valeur_type: "montant"`, pas « 1 600 $ » dans un texte) ; aucun doublon
// d'empreinte ; et le découpage respecte `LOT_MAX`.

import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { LOT_MAX } from "../lib/ecrireFaits";
import { validerFait } from "../lib/validerFait";
import { TAILLE_LOT, decouperEnLots, lireSeed, normaliser, normaliserFichier } from "../scripts/seed.mjs";

const DOSSIER = resolve(process.cwd(), "seed");
const fichiers = readdirSync(DOSSIER)
  .filter((f) => f.endsWith(".json"))
  .map((f) => resolve(DOSSIER, f));

/** Un montant dans un texte : « 1 600 $ », « $1,600 », « 25 000 dollars ». */
const MONTANT = /(\d[\d\s ,.]*\s?\$|\$\s?\d|\d\s?(dollars?|euros?|CAD|USD)\b)/i;

describe("scripts/seed.mjs", () => {
  it("découpe par lots de LOT_MAX, jamais plus", () => {
    expect(TAILLE_LOT).toBe(LOT_MAX);
    const lots = decouperEnLots(Array.from({ length: 105 }, (_, i) => i));
    expect(lots.map((l) => l.length)).toEqual([50, 50, 5]);
    expect(decouperEnLots([])).toEqual([]);
  });

  it("dérive la provenance de `source`, et ne transmet dossier/type_document que s'ils sont écrits", () => {
    const f = { extracteur: "x", date_source: "2026-09-15", documents: { a: "1AbCdEfGhIjKlMnOp", b: null }, faits: [] };
    const base = { predicat: "p.q", valeur: "v", valeur_type: "texte" as const };
    expect(normaliser({ ...base, source: "doc:a" }, f).provenance).toMatchObject({ source_type: "document", source_ref: "1AbCdEfGhIjKlMnOp" });
    expect(normaliser({ ...base, source: "doc:b" }, f).provenance).toMatchObject({ source_type: "seed", source_ref: "drive:b" });
    expect(normaliser({ ...base, source: "app:carai" }, f).provenance).toMatchObject({ source_type: "app", source_ref: "carai" });
    expect(normaliser({ ...base, source: "session" }, f).provenance).toMatchObject({ source_type: "seed", source_ref: "session-2026-09-15" });
    expect(normaliser({ ...base, source: "doc:a" }, f).provenance).not.toHaveProperty("dossier");
    expect(normaliser({ ...base, source: "doc:a", dossier: "04 · Immigration" }, f).provenance).toHaveProperty("dossier", "04 · Immigration");
    expect(() => normaliser({ ...base, source: "doc:zzz" }, f)).toThrow(/alias/);
    expect(() => normaliser({ ...base }, f)).toThrow(/pointeur/);
    expect(normaliser({ ...base, valeur: "1AbCdEfGhIjKlMnOp", valeur_type: "ref_document" }, f).provenance).toMatchObject({
      source_type: "document",
      source_ref: "1AbCdEfGhIjKlMnOp",
    });
  });
});

describe.each(fichiers)("seed %s", (chemin) => {
  const fichier = lireSeed(chemin);
  const faits = normaliserFichier(fichier);

  it("a au moins un fait", () => {
    expect(faits.length).toBeGreaterThan(0);
  });

  it("chaque fait est accepté par validerFait avec le jeton `seed`", () => {
    const refus = faits
      .map((f, i) => ({ i, v: validerFait(f, { fiabilites: ["seed"] }) }))
      .filter((x) => !x.v.ok)
      .map((x) => `#${x.i + 1} ${faits[x.i]!.predicat} : ${!x.v.ok ? `${x.v.code} — ${x.v.raison}` : ""}`);
    expect(refus).toEqual([]);
  });

  it("aucune valeur textuelle ne porte un montant", () => {
    const fautifs = fichier.faits.filter((e) => e.valeur_type === "texte" && MONTANT.test(e.valeur)).map((e) => e.valeur);
    expect(fautifs).toEqual([]);
    // Anti-vacuité : le motif reconnaît bien un montant, et pas un kilométrage.
    expect(MONTANT.test("loyer de 1 600 $ par mois")).toBe(true);
    expect(MONTANT.test("112 000 km sur 48 mois")).toBe(false);
  });

  it("aucun doublon d'empreinte (sujet, prédicat, source_ref, extracteur, valeur)", () => {
    const cles = faits.map((f) => [f.sujet, f.predicat, f.provenance.source_ref, f.provenance.extracteur, f.valeur].join("|"));
    expect(new Set(cles).size).toBe(cles.length);
  });

  it("se découpe en lots acceptés par la route", () => {
    for (const lot of decouperEnLots(faits)) expect(lot.length).toBeLessThanOrEqual(LOT_MAX);
  });
});
