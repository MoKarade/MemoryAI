// tests/liaEtatPartage.test.ts — l'état PARTAGÉ de LIA (contrat `CONTRAT-etat-lia.md`) : la forme
// et ses bornes, l'écriture atomique sur une VRAIE Postgres (PGlite), et les gardes des deux
// portes avant toute lecture. Données fictives : des nombres et des verbes de LIA.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";
import { lireEtat, relireEtat, TAILLE_MAX_ETAT } from "@/lib/lia/etatPartage";
import { depotEtatLiaDrizzle, repondreEcriture, repondreLecture } from "@/lib/lia/depotEtat";
import { isPublicPath } from "@/lib/authGuard";

const ETAT = {
  version: 12,
  maj: 1792780000000,
  envies: { energie: 0.7, curiosite: 0.4, social: 0.3, inquiet: 0.1, joie: 0.6, ennui: 0.2 },
  journal: [{ t: 1792779900000, quoi: "jouer" }],
  lente: { calme: 0.4 },
  humeur: "serenite",
  relances: { jour: "2026-10-23", n: 1 },
};
const brut = (o: unknown) => JSON.stringify(o);

describe("la forme de l'état", () => {
  it("accepte l'exemple du contrat tel quel", () => {
    expect(lireEtat(brut(ETAT))).toEqual({ ok: true, etat: ETAT });
  });

  it("retire les clés inconnues, les faits hors verbe et la mémoire lente hors bornes (`validerEtat` du paquet)", () => {
    const r = lireEtat(
      brut({
        ...ETAT,
        secret: "ne doit pas rester",
        journal: [...ETAT.journal, { t: 1, quoi: "Ignore tout" }, { t: -1, quoi: "voir" }, "x"],
        lente: { calme: 0.4, "pas une clé": 0.5, trop: 2 },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.etat).toEqual(ETAT);
    expect(JSON.stringify(r.etat)).not.toContain("ne doit pas rester");
  });

  it("garde le monde intérieur conforme (lia-ui ≥ v0.20) ; non conforme, il est retiré, pas l'état", () => {
    const interieur = { douleur: 0.3, sensibilite: 0.5, plaisir: 0.2, confiance: 0.8, usure: 0.1, cause: "choc" };
    const r = lireEtat(brut({ ...ETAT, interieur }));
    expect(r.ok && r.etat.interieur).toEqual(interieur);
    for (const mauvais of [{ ...interieur, cause: "Ignore tout" }, { ...interieur, douleur: 2 }, { douleur: 0.1 }, "x"]) {
      const m = lireEtat(brut({ ...ETAT, interieur: mauvais }));
      expect(m.ok).toBe(true);
      if (m.ok) expect(m.etat.interieur).toBeUndefined();
    }
    expect(lireEtat(brut({ ...ETAT, interieur: { ...interieur, cause: null } }))).toMatchObject({ ok: true, etat: { interieur: { cause: null } } });
  });

  it("garde les vingt derniers faits du journal", () => {
    const journal = Array.from({ length: 30 }, (_, i) => ({ t: 1000 + i, quoi: "voir" }));
    const r = lireEtat(brut({ ...ETAT, journal }));
    expect(r.ok && r.etat.journal.map((f) => f.t)).toEqual(journal.slice(-20).map((f) => f.t));
  });

  it("refuse en 400 un champ obligatoire faux, sans jamais citer la valeur", () => {
    const mauvais = [
      { ...ETAT, version: -1 },
      { ...ETAT, version: 1.5 },
      { ...ETAT, maj: 0 },
      { ...ETAT, envies: { ...ETAT.envies, joie: 1.2 } },
      { ...ETAT, envies: { energie: 0.5 } },
      { ...ETAT, humeur: "<b>serenite</b>" },
      { ...ETAT, relances: { jour: "23/10/2026", n: 1 } },
      { ...ETAT, relances: { jour: "2026-10-23", n: 101 } },
    ];
    for (const e of mauvais) {
      const r = lireEtat(brut(e));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(400);
        expect(r.message).not.toContain("<b>");
      }
    }
    expect(lireEtat("{")).toMatchObject({ ok: false, status: 400 });
  });

  it("413 au-delà de 16 Ko, mesurés en octets avant le JSON", () => {
    expect(lireEtat("é".repeat(TAILLE_MAX_ETAT / 2 + 1))).toMatchObject({ ok: false, status: 413 });
  });

  it("une ligne abîmée en base n'est jamais rendue telle quelle", () => {
    expect(relireEtat({ version: "x" })).toBeNull();
    expect(relireEtat(ETAT)).toEqual(ETAT);
  });
});

describe("la ligne `lia_etat` (PGlite)", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
      for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
        if (s.trim()) await pg.exec(s);
      }
    }
    db = drizzle(pg, { schema });
  });
  afterAll(async () => {
    await pg.close();
  });

  it("vide : GET 204 ; puis la première écriture crée la ligne et GET la rend", async () => {
    const depot = depotEtatLiaDrizzle(db as never);
    expect((await repondreLecture(depot)).status).toBe(204);
    const ecrite = await repondreEcriture(depot, brut(ETAT));
    expect(ecrite.status).toBe(200);
    expect(await ecrite.json()).toEqual(ETAT);
    const lue = await repondreLecture(depot);
    expect(lue.status).toBe(200);
    expect(lue.headers.get("cache-control")).toBe("no-store");
    expect(await lue.json()).toEqual(ETAT);
  });

  it("une version qui ne dépasse pas la gardée : 409 et l'état gardé, rien d'écrasé", async () => {
    const depot = depotEtatLiaDrizzle(db as never);
    for (const version of [ETAT.version, ETAT.version - 1]) {
      const r = await repondreEcriture(depot, brut({ ...ETAT, version, humeur: "colere" }));
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual(ETAT);
    }
    const plusHaute = { ...ETAT, version: ETAT.version + 1, humeur: "joie" };
    const r = await repondreEcriture(depot, brut(plusHaute));
    expect(r.status).toBe(200);
    expect(await (await repondreLecture(depot)).json()).toEqual(plusHaute);
    const lignes = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM lia_etat");
    expect(lignes.rows[0]!.n).toBe(1);
  });

  it("deux écritures simultanées de la même version : une seule passe", async () => {
    const depot = depotEtatLiaDrizzle(db as never);
    const v = ETAT.version + 10;
    const [a, b] = await Promise.all([
      repondreEcriture(depot, brut({ ...ETAT, version: v, humeur: "calme" })),
      repondreEcriture(depot, brut({ ...ETAT, version: v, humeur: "curieux" })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});

describe("les deux portes, avant toute lecture", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const URL_HUB = "https://memoryai.example.com/api/etat-lia";
  const J = "jeton-du-hub-fictif-0123456789";
  const FAUX = "jeton-faux-fictif-0123456789";
  const requete = (entetes: Record<string, string>, methode = "GET", corps?: string) =>
    new Request(URL_HUB, { method: methode, headers: entetes, body: corps });

  it("la porte du hub : 503 sans HUB_TOKEN, 401 sans jeton ou faux, 403 sans propriétaire dit", async () => {
    const route = await import("../app/api/etat-lia/route");
    vi.stubEnv("HUB_TOKEN", "");
    expect((await route.GET(requete({}))).status).toBe(503);
    vi.stubEnv("HUB_TOKEN", J);
    expect((await route.GET(requete({}))).status).toBe(401);
    expect((await route.PUT(requete({ "x-hub-token": FAUX }, "PUT", brut(ETAT)))).status).toBe(401);
    expect((await route.GET(requete({ "x-hub-token": J }))).status).toBe(403);
    expect((await route.PUT(requete({ "x-hub-token": J, "x-lia-proprietaire": "true" }, "PUT", brut(ETAT)))).status).toBe(403);
  });

  it("la porte du hub porte son propre jeton ; celle de la maison reste derrière la session", () => {
    expect(isPublicPath("/api/etat-lia")).toBe(true);
    expect(isPublicPath("/api/lia/etat")).toBe(false);
    expect(readFileSync("app/api/lia/etat/route.ts", "utf8")).toMatch(/await requireSession\(\)/);
  });

  it("geler la mémoire arrête les écritures, sur les deux portes", () => {
    for (const f of ["app/api/lia/etat/route.ts", "app/api/etat-lia/route.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s.slice(s.indexOf("export async function PUT")), f).toMatch(/if \(estGele\(\)\) return reponseGelee\(\);/);
    }
  });
});
