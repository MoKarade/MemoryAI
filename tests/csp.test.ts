// tests/csp.test.ts — la CSP ne coupe pas les flux qu'elle traverse.
//
// `form-action` est la directive qui a cassé le branchement du connecteur le 15/09/2026, et
// elle l'a cassé de la pire façon : le serveur répondait `302` avec un code d'autorisation
// valide, le navigateur refusait de suivre, et l'écran ne bougeait pas. Aucune erreur nulle
// part — dix-huit tentatives côté Marc, zéro appel à `/api/mcp/token` côté serveur.
//
// Ce test verrouille les deux moitiés : la directive autorise les origines de Claude, et
// elle reste d'accord avec l'allowlist du CODE. Deux listes qui disent la même chose
// divergent toujours ; celle-ci décide qui peut recevoir un code, celle du navigateur décide
// si la redirection passe.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const config = readFileSync(resolve(process.cwd(), "next.config.mjs"), "utf8");

/**
 * La DIRECTIVE, jamais la prose qui l'explique.
 *
 * Le commentaire au-dessus contient le mot `form-action` : un `includes` attraperait la
 * phrase et jugerait la ligne d'à côté. On ancre donc sur la forme de la valeur — guillemet,
 * nom de la directive, espace — comme le test jumeau de BatchChef, écrit après être tombé
 * exactement dans ce piège.
 */
function directiveFormAction(): string | undefined {
  return config.split("\n").find((l) => l.trimStart().startsWith('"form-action '));
}

describe("CSP — form-action", () => {
  it("existe, et n'est pas confondue avec le commentaire qui la décrit", () => {
    const ligne = directiveFormAction();
    expect(ligne, "directive form-action introuvable").toBeDefined();
    expect(ligne).toContain("'self'");
    // Anti-vacuité : le sélecteur reconnaît une directive et refuse une phrase à son sujet.
    const faux = ["  // form-action doit autoriser Claude", "const x = 1;"];
    expect(faux.find((l) => l.trimStart().startsWith('"form-action '))).toBeUndefined();
  });

  it("autorise le retour du connecteur vers Claude", () => {
    const ligne = directiveFormAction() ?? "";
    expect(ligne).toContain("https://claude.ai");
    expect(ligne).toContain("https://claude.com");
  });

  it("dit la même chose que l'allowlist du code OAuth", () => {
    const oauth = readFileSync(resolve(process.cwd(), "lib/mcp/oauth.ts"), "utf8");
    const bloc = /DEFAULT_ALLOWED_ORIGINS\s*=\s*\[([^\]]*)\]/.exec(oauth)?.[1] ?? "";
    const admises = [...bloc.matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]!);
    expect(admises.length, "allowlist OAuth introuvable").toBeGreaterThan(0);
    const ligne = directiveFormAction() ?? "";
    for (const origine of new Set(admises)) {
      expect(ligne, `${origine} est admise par le code OAuth mais absente de form-action`).toContain(origine);
    }
  });
});
