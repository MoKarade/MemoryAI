// tests/migration0038.test.ts — la migration 0038 (troisième lecture) est ADDITIVE (ADR 0026, amendement du 28/10/2026).
//
// Elle tourne en production au merge : rien ne doit être supprimé, renommé ni réécrit, et aucune
// colonne obligatoire sans défaut ne doit casser les lignes existantes de `relectures_pieces`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Les clauses d'un fichier de migration, hors commentaires, séparées par instruction. */
function instructions(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Vrai si chaque instruction est un `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` facultatif et rien d'autre. */
function estAdditive(sql: string): boolean {
  const toutes = instructions(sql);
  if (toutes.length === 0) return false;
  return toutes.every((instruction) => {
    if (!/^ALTER TABLE "relectures_pieces"\s+ADD COLUMN IF NOT EXISTS /.test(instruction)) return false;
    if (/\b(DROP|RENAME|UPDATE|DELETE|TRUNCATE|ALTER COLUMN|SET NOT NULL)\b/i.test(instruction)) return false;
    if (/NOT NULL/i.test(instruction)) return false;
    return instruction.split(/,\s*\n/).every((clause) => /^(ALTER TABLE "relectures_pieces"\s+)?ADD COLUMN IF NOT EXISTS /.test(clause.trim()));
  });
}

describe("migration 0038 : une troisième lecture", () => {
  const sql = readFileSync(resolve(process.cwd(), "drizzle", "0038_troisieme_lecture.sql"), "utf8");

  it("n'a que des ADD COLUMN IF NOT EXISTS facultatifs sur relectures_pieces", () => {
    expect(estAdditive(sql)).toBe(true);
  });

  it("ajoute exactement les quatre colonnes de la trace, sans valeur de champ", () => {
    const colonnes = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]);
    expect(colonnes).toEqual(["empreinte_tierce", "extracteur_tierce", "egale", "tierce_le"]);
  });

  it("ROUGE : une migration qui supprime, renomme, réécrit ou impose une colonne obligatoire n'est pas additive", () => {
    const prefixe = 'ALTER TABLE "relectures_pieces"';
    expect(estAdditive(`${prefixe} DROP COLUMN "divergents";`)).toBe(false);
    expect(estAdditive(`${prefixe} RENAME COLUMN "jour" TO "le_jour";`)).toBe(false);
    expect(estAdditive(`${prefixe} ADD COLUMN IF NOT EXISTS "x" text NOT NULL;`)).toBe(false);
    expect(estAdditive(`${prefixe} ADD COLUMN IF NOT EXISTS "x" text;\nUPDATE "relectures_pieces" SET "x" = 'a';`)).toBe(false);
    expect(estAdditive(`${prefixe} ADD COLUMN IF NOT EXISTS "x" text,\n  ALTER COLUMN "jour" DROP NOT NULL;`)).toBe(false);
    expect(estAdditive("-- rien\n")).toBe(false);
  });
});
