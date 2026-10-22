// tests/liaMaison.test.ts — LIA dans sa maison (ADR 0016 § 7) : la porte de la session, et le
// `ask` du navigateur. Données fictives.

import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ ok: false }));
// Le vrai module tire next-auth : la porte n'a besoin que de `requireSession` et de `NonAutorise`.
vi.mock("@/lib/session", () => {
  class NonAutorise extends Error {}
  return {
    NonAutorise,
    requireSession: async () => {
      if (!session.ok) throw new NonAutorise("Session absente (test).");
      return { email: "proprietaire@example.com" };
    },
  };
});

import { DEMANDE_MAISON, LECTEUR_LIA_MAISON, lireDemande } from "../lib/lia/ask";
import { demanderLia } from "../lib/lia/client";
import { lecteurPeutN3 } from "../lib/lecture";

const requete = (brut: string) => new Request("https://memoryai.example.com/api/lia/ask", { method: "POST", body: brut });

describe("la demande de la maison", () => {
  it("⚠ source et propriétaire sont IMPOSÉS, jamais lus du navigateur", () => {
    const r = lireDemande(JSON.stringify({ question: "Mon bail ?", page: "/fait", source: "autre-app", proprietaire: false }), DEMANDE_MAISON);
    expect(r).toEqual({ ok: true, demande: { question: "Mon bail ?", page: "/fait", source: "memoryai", proprietaire: true } });
  });

  it("un corps qui n'est pas un objet reste un 400 ; sans `impose`, le hub garde sa règle", () => {
    expect(lireDemande("[1]", DEMANDE_MAISON)).toMatchObject({ ok: false, status: 400 });
    expect(lireDemande(JSON.stringify({ question: "x" }))).toMatchObject({ ok: false, status: 400 });
  });

  it("⚠ le niveau 3 reste fermé à LIA dans sa maison aussi", () => {
    expect(lecteurPeutN3(LECTEUR_LIA_MAISON)).toBe(false);
  });
});

describe("la route POST /api/lia/ask, avant tout appel au modèle", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    session.ok = false;
  });

  it("503 gelée, 401 sans session, puis 400 sur un corps faux", async () => {
    const route = await import("../app/api/lia/ask/route");
    vi.stubEnv("MEMORYAI_GEL", "1");
    expect((await route.POST(requete("{}"))).status).toBe(503);
    vi.stubEnv("MEMORYAI_GEL", "");
    const sans = await route.POST(requete(JSON.stringify({ question: "x" })));
    expect(sans.status).toBe(401);
    expect(sans.headers.get("cache-control")).toBe("no-store");
    session.ok = true;
    expect((await route.POST(requete("{"))).status).toBe(400);
  });

  it("session, bon corps, rien de configuré : 503 nommé, jamais une réponse inventée", async () => {
    const route = await import("../app/api/lia/ask/route");
    session.ok = true;
    vi.stubEnv("MEMORYAI_CHIFFREMENT", "");
    const r = await route.POST(requete(JSON.stringify({ question: "Mon bail ?" })));
    expect(r.status).toBe(503);
    expect(((await r.json()) as { text?: string }).text).toBeUndefined();
  });
});

describe("demanderLia (navigateur)", () => {
  const signal = new AbortController().signal;
  const repond = (status: number, corps: unknown) => vi.fn(async () => new Response(JSON.stringify(corps), { status }));

  it("rend le texte et les blocs, à la même origine, sans jeton", async () => {
    const f = repond(200, { text: "Le 31 janvier.", blocks: [{ type: "chiffre" }] });
    expect(await demanderLia("Mon bail ?", signal, { fetchImpl: f, page: "/memoire" })).toEqual({ text: "Le 31 janvier.", blocks: [{ type: "chiffre" }] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/lia/ask");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(init.body as string)).toEqual({ question: "Mon bail ?", page: "/memoire" });
  });

  it("⚠ un refus ou une réponse non conforme est un REJET : LIA dit « indisponible »", async () => {
    await expect(demanderLia("x", signal, { fetchImpl: repond(503, { error: "api_absente" }) })).rejects.toThrow(/indisponible/);
    await expect(demanderLia("x", signal, { fetchImpl: repond(200, { texte: "faux" }) })).rejects.toThrow(/non conforme/);
  });
});
