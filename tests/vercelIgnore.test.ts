// tests/vercelIgnore.test.ts — pas de préversion Vercel inutile, jamais de production sautée (étape 2 de la structure commune).
// La logique complète (faux dépôts git) est testée dans l'Atelier (modeles/vercel/tests) ; ici on vérifie le BRANCHEMENT dans ce dépôt.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decider, estDocumentation, CONSTRUIRE, IGNORER } from "../.github/ci/ignore-command.mjs";

const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const PREVIEW = { VERCEL_ENV: "preview" };

describe("vercel.json", () => {
  it("déclare l'ignoreCommand, sous .github/ (chemin sensible : une PR ne le réécrit pas sans attestation)", () => {
    expect(vercel.ignoreCommand).toBe("node .github/ci/ignore-command.mjs");
  });

  it("décale le cron d'apprentissage à 09:07 UTC et garde celui du réseau (tâche MemoryAI 186)", () => {
    expect(vercel.crons).toEqual([
      { path: "/api/cron/apprentissage", schedule: "7 9 * * *" },
      { path: "/api/cron/reseau", schedule: "27 10 * * *" },
    ]);
  });
});

describe("ignore-command : la décision", () => {
  it("ignore une préversion de docs seules ou de dependabot", () => {
    expect(decider({ env: PREVIEW, fichiers: ["README.md", "docs/a.md", ".github/workflows/ci.yml"] }).code).toBe(IGNORER);
    expect(decider({ env: { ...PREVIEW, VERCEL_GIT_COMMIT_REF: "dependabot/npm_and_yarn/x" }, fichiers: ["package.json"] }).code).toBe(IGNORER);
  });

  it("construit toujours : code, mélange, production, environnement inconnu, doute", () => {
    expect(decider({ env: PREVIEW, fichiers: ["app/page.tsx"] }).code).toBe(CONSTRUIRE);
    expect(decider({ env: PREVIEW, fichiers: ["docs/a.md", "lib/x.ts"] }).code).toBe(CONSTRUIRE);
    expect(decider({ env: { VERCEL_ENV: "production" }, fichiers: ["README.md"] }).code).toBe(CONSTRUIRE);
    expect(decider({ env: {}, fichiers: ["README.md"] }).code).toBe(CONSTRUIRE);
    expect(decider({ env: PREVIEW, fichiers: null }).code).toBe(CONSTRUIRE);
    expect(decider({ env: PREVIEW, fichiers: [] }).code).toBe(CONSTRUIRE);
  });

  it("sous docs/, seuls texte, images et PDF sont de la documentation", () => {
    expect(estDocumentation("docs/schema.png")).toBe(true);
    expect(estDocumentation("docs/script.js")).toBe(false);
    expect(estDocumentation("docs/data.json")).toBe(false);
  });
});
