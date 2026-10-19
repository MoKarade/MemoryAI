// tests/cronApprentissageMethode.test.ts — le réveil quotidien de Vercel doit ATTEINDRE la passe.
//
// Vercel Cron appelle ses chemins en GET. La route n'exportait que POST : le cron de
// `vercel.json` recevait un 405, en silence, chaque jour (mesuré le 24/09). Cette garde exige
// que tout chemin déclaré dans `vercel.json` réponde en GET, et que GET porte la MÊME garde
// que POST — un GET ouvert serait pire que le défaut qu'il corrige.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const racine = process.cwd();

describe("cron d'apprentissage : la méthode que Vercel emploie", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("chaque chemin de vercel.json a une route qui exporte GET", async () => {
    const config = JSON.parse(readFileSync(join(racine, "vercel.json"), "utf8")) as {
      crons?: { path: string }[];
    };
    const chemins = (config.crons ?? []).map((c) => c.path);
    // Anti-vacuité : sans cron déclaré, la garde ne vérifierait rien.
    expect(chemins).toContain("/api/cron/apprentissage");
    for (const chemin of chemins) {
      const source = readFileSync(join(racine, "app", chemin, "route.ts"), "utf8");
      expect(source, `${chemin} doit exporter GET (Vercel Cron appelle en GET)`).toMatch(
        /export\s+(const\s+GET\b|(async\s+)?function\s+GET\b)/,
      );
    }
  });

  it("GET porte la même garde que POST : 503 sans secret, 401 avec un faux", async () => {
    const route = await import("../app/api/cron/apprentissage/route");
    const url = "https://memoryai.hubperso.com/api/cron/apprentissage";

    vi.stubEnv("CRON_SECRET", "");
    expect((await route.GET(new Request(url))).status).toBe(503);

    vi.stubEnv("CRON_SECRET", "le-bon");
    const faux = new Request(url, { headers: { authorization: "Bearer le-mauvais" } });
    expect((await route.GET(faux)).status).toBe(401);
    expect((await route.GET(new Request(url))).status).toBe(401);
  });
});
