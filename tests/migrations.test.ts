// tests/migrations.test.ts — deux gardes sur l'appareil de migration.
//
// 1. Sans DATABASE_URL, `assurerMigrations` ne tente rien et ne lève rien : le build et les
//    pages sans base restent honnêtes.
// 2. TOUT fichier de `app/` ou `lib/` qui importe la base appelle `assurerMigrations` (ou
//    est explicitement exempté ici, avec sa raison). Leçon JobAI : trois routes OAuth
//    rendaient « 500 sans corps » sur une base neuve parce qu'aucune ne demandait les
//    migrations — et aucun test ne pouvait le voir.

import { describe, it, expect, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { assurerMigrations, etatMigrations, reinitialiserMigrations } from "../lib/migrations";

/** Modules qui importent `@/lib/db` SANS appeler `assurerMigrations`, et pourquoi. */
const EXEMPTES: Record<string, string> = {
  "lib/migrations.ts": "c'est lui qui applique les migrations",
};

describe("assurerMigrations sans base", () => {
  beforeEach(() => reinitialiserMigrations());

  it("ne tente rien quand DATABASE_URL est absente", async () => {
    const avant = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(assurerMigrations()).resolves.toBeUndefined();
      expect(etatMigrations()).toEqual({ tentee: false, erreur: null });
    } finally {
      if (avant !== undefined) process.env.DATABASE_URL = avant;
    }
  });
});

describe("tout point d'entrée qui touche la base demande les migrations", () => {
  it("aucun module de app/ ou lib/ n'importe la base sans appeler assurerMigrations", () => {
    const fichiers = execSync("git ls-files --cached --others --exclude-standard app lib", {
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f));

    const importeLaBase = (s: string) =>
      /from\s+["'](@\/lib\/db|\.\.?\/(?:\.\.\/)*db)(?:\/index)?["']/.test(s);

    const fautifs = fichiers.filter((f) => {
      if (f in EXEMPTES) return false;
      const s = readFileSync(f, "utf8");
      return importeLaBase(s) && !/assurerMigrations\(/.test(s);
    });
    expect(fautifs).toEqual([]);

    // Anti-vacuité : le motif reconnaît bien un import de la base.
    expect(importeLaBase('import { db } from "@/lib/db";')).toBe(true);
    expect(importeLaBase('import { db } from "./db";')).toBe(true);
    expect(importeLaBase('import { x } from "@/lib/gel";')).toBe(false);
  });
});
