// tests/hubSummary.test.ts — le Route Handler /hub/summary : auth (échec fermé) et
// payload validé par le VRAI schéma du contrat.
//
// La comparaison de jetons en temps constant n'est plus testée ICI : elle a quitté ce dépôt
// pour `@mokarade/hub-contract/endpoint`, qui la teste chez lui. Ce qui reste testé ici est
// ce qui appartient VRAIMENT à cette app — que la route soit bien câblée sur le helper, et
// que le payload publié soit conforme. Un test qui rejouerait `jetonsEgaux` ne prouverait
// plus rien sur ce dépôt : il vérifierait une dépendance.

import { describe, it, expect } from "vitest";
import {
  CONTRACT_VERSION,
  HUB_TOKEN_HEADER,
  validateSummary,
} from "@mokarade/hub-contract";
import { GET } from "../app/hub/summary/route";

const JETON = "jeton-de-test-memoryai-0123456789";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://memoryai.hubperso.com/hub/summary", { headers });
}

/**
 * Pose `HUB_TOKEN` le temps d'un cas, puis le restaure.
 *
 * ⚠️ Le `await fn()` est INDISPENSABLE, et il manquait. Avec `return fn()`, le `finally`
 * s'exécutait dès que `fn` rendait sa promesse — c'est-à-dire à sa PREMIÈRE suspension, pas
 * à sa fin. La variable était donc restaurée AU MILIEU du cas.
 *
 * Ça ne se voyait pas tant que la route était synchrone : elle allait jusqu'au bout avant de
 * rendre la main, et le helper était correct par accident. Le passage de la route en
 * asynchrone (bascule sur `serveSummary`) a fait apparaître la faute — le deuxième appel d'un
 * même cas recevait 503 « hub désactivé » au lieu de 401, parce que le jeton attendu avait
 * déjà disparu de l'environnement.
 *
 * La leçon générale : un utilitaire de test qui prend un `fn` pouvant être asynchrone doit
 * l'attendre, même si tous ses appelants du jour sont synchrones. Sinon il ne tient plus le
 * jour où l'un d'eux ne l'est plus, et il échoue en accusant le code testé.
 */
async function withHubToken(
  value: string | undefined,
  fn: () => void | Promise<void>,
): Promise<void> {
  const before = process.env.HUB_TOKEN;
  if (value === undefined) delete process.env.HUB_TOKEN;
  else process.env.HUB_TOKEN = value;
  try {
    await fn();
  } finally {
    if (before === undefined) delete process.env.HUB_TOKEN;
    else process.env.HUB_TOKEN = before;
  }
}

describe("GET /hub/summary", () => {
  it("503 si HUB_TOKEN non configuré, sans summary — hub désactivé, pas erreur interne", async () => {
    await withHubToken(undefined, async () => {
      const res = await GET(req({ [HUB_TOKEN_HEADER]: JETON }));
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain("contractVersion");
    });
  });

  it("401 sans jeton et avec un jeton invalide", async () => {
    await withHubToken(JETON, async () => {
      expect((await GET(req())).status).toBe(401);
      expect((await GET(req({ [HUB_TOKEN_HEADER]: "mauvais" }))).status).toBe(401);
    });
  });

  it("200 : building summary conforme au contrat + no-store", async () => {
    await withHubToken(JETON, async () => {
      const res = await GET(req({ [HUB_TOKEN_HEADER]: JETON }));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      // La traduction `SummaryResponse` → `Response` est le SEUL code neuf de ce fichier :
      // le helper rend des en-têtes, c'est la route qui les repose. Un oubli ici servirait
      // du JSON en `text/plain`, ce qu'aucun test de contrat n'attraperait.
      expect(res.headers.get("content-type")).toContain("application/json");

      const summary = validateSummary(await res.json());
      expect(summary.contractVersion).toBe(CONTRACT_VERSION);
      expect(summary.status).toBe("building");
      expect(summary.metrics).toEqual([]);
      expect(summary.actions).toEqual([]);
      expect(summary.alerts).toHaveLength(1);
      expect(summary.app.id).toBe("memoryai");
    });
  });
});
