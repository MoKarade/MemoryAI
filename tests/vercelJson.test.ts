// tests/vercelJson.test.ts — verrou de `vercel.json` : seule la branche principale se déploie.
//
// Pourquoi : sans règle, Vercel crée une préversion pour CHAQUE branche, les branches
// `mergify/merge-queue/*` de la file de fusion comprises (constaté le 16/10/2026 : « Merge of #154 »,
// `target: null`, READY). Chaque préversion consomme le quota de déploiements, PARTAGÉ entre les
// apps, et peut toucher une base commune. Tâche MemoryAI#125 ; même règle et même verrou
// qu'app-template (#41) et Hubperso (#160).
//
// Sémantique (doc Vercel, « Git configuration ») : `git.deploymentEnabled` associe des motifs
// minimatch de branche à un booléen ; une branche non citée se déploie ; une branche qui
// correspond à plusieurs règles se déploie si AU MOINS UNE vaut `true`. D'où la forme :
// `**` et `*` coupent tout, `main: true` rouvre la seule porte voulue. `*` seul ne couvre pas
// `claude/x` (pas de `/`), et `**` seul couperait aussi `main`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Regles = Record<string, boolean>;

const conf = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  git?: { deploymentEnabled?: Regles | boolean };
  ignoreCommand?: string;
  crons?: { path: string }[];
};

/** Motif minimatch réduit à ce que `vercel.json` emploie ici : `**`, `*`, littéral. */
function correspond(motif: string, branche: string): boolean {
  const source = motif
    .split("**")
    .map((morceau) =>
      morceau
        .split("*")
        .map((m) => m.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${source}$`).test(branche);
}

/** Pur : la règle de la doc Vercel. Défaut `true` ; au moins une règle vraie suffit. */
function sedeploie(branche: string, regles: Regles): boolean {
  const applicables = Object.entries(regles).filter(([motif]) => correspond(motif, branche));
  if (applicables.length === 0) return true;
  return applicables.some(([, actif]) => actif);
}

/** Copie des règles privée d'un motif. */
function sans(regles: Regles, motif: string): Regles {
  return Object.fromEntries(Object.entries(regles).filter(([m]) => m !== motif));
}

describe("vercel.json — seule la branche principale se déploie", () => {
  const regles = conf.git?.deploymentEnabled;

  it("déclare des règles par branche (pas un booléen global, qui couperait aussi la production)", () => {
    expect(typeof regles, "git.deploymentEnabled doit être un objet de motifs").toBe("object");
  });

  it("déploie `main`", () => {
    expect(sedeploie("main", regles as Regles)).toBe(true);
  });

  it.each([
    "claude/socle-visuel",
    "claude/a/b",
    "feature/essai",
    "dependabot/npm_and_yarn/next-16.4.0",
    "mergify/merge-queue/abc123",
    "test",
    "main-bis",
    "Main",
  ])("ne déploie pas la branche `%s`", (branche) => {
    expect(sedeploie(branche, regles as Regles)).toBe(false);
  });

  it("le garde discrimine : sans `main: true`, la production serait coupée", () => {
    // Preuve que `sedeploie` n'est pas vert à vide : retirer la règle d'ouverture change le résultat.
    const sansMain = sans(regles as Regles, "main");
    expect(sedeploie("main", sansMain)).toBe(false);
  });

  it("le garde discrimine : sans `**`, une branche imbriquée se déploierait", () => {
    const sansProfond = sans(regles as Regles, "**");
    expect(sedeploie("claude/socle-visuel", sansProfond)).toBe(true);
  });

  it("garde l'ignoreCommand et le cron existants", () => {
    expect(conf.ignoreCommand).toBe("node .github/ci/ignore-command.mjs");
    expect(conf.crons?.map((c) => c.path)).toEqual(["/api/cron/apprentissage", "/api/cron/reseau"]);
  });
});
