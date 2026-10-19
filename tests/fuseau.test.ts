// tests/fuseau.test.ts — le fuseau de Marc est écrit UNE fois, et rien ne le recopie.
//
// Vercel tourne en UTC : une date affichée sans `timeZone` est fausse de 4 ou 5 heures selon
// la saison, sans aucun signe extérieur. La valeur vivait en dur dans `lib/coutChat.ts` ; la
// recopier dans la page des conversations aurait fait diverger le jour que le plafond protège
// et les dates qu'on montre, un jour d'été où seul l'un des deux aurait été corrigé.

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FUSEAU } from "../lib/fuseau";
import { jourQuebec } from "../lib/coutChat";

const fichiers = execSync("git ls-files --cached --others --exclude-standard lib app components", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

describe("FUSEAU", () => {
  it("l'hiver comme l'été, le jour du Québec n'est pas celui d'UTC", () => {
    // 1 h 30 UTC le 1er juillet = 21 h 30 la veille à Québec (UTC−4).
    expect(jourQuebec(new Date("2026-07-01T01:30:00Z"))).toBe("2026-06-30");
    // 1 h 30 UTC le 1er janvier = 20 h 30 la veille (UTC−5). Un décalage écrit en dur
    // échouerait sur l'un des deux : c'est ce que ce cas d'hiver existe pour attraper.
    expect(jourQuebec(new Date("2026-01-01T01:30:00Z"))).toBe("2025-12-31");
  });

  it("aucun fichier ne recopie le nom du fuseau, sauf celui qui le définit", () => {
    expect(fichiers.length, "anti-vacuité").toBeGreaterThan(20);
    const offenders = fichiers.filter(
      (f) => f !== "lib/fuseau.ts" && /timeZone:\s*["']/.test(readFileSync(f, "utf8")),
    );
    expect(offenders, "ces fichiers écrivent un fuseau en dur au lieu d'importer FUSEAU").toEqual([]);
  });

  it("tout formatage de date passe par FUSEAU — et FUSEAU est celui du Québec", () => {
    expect(FUSEAU).toBe("America/Toronto");
    const offenders = fichiers.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /new Intl\.DateTimeFormat/.test(src) && !/timeZone:\s*FUSEAU/.test(src);
    });
    expect(offenders, "ces fichiers formatent une date sans fuseau : Vercel est en UTC").toEqual([]);
  });
});
