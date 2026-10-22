// tests/liaAsk.test.ts — LIA répond au hub (ADR 0016) : ce qu'elle accepte, ce qu'elle rend,
// et les gardes de la route AVANT tout appel au modèle. Données fictives.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composerQuestion,
  composerReponse,
  CONVERSATIONS_FERMEES,
  LECTEUR_LIA_HUB,
  LONGUEUR_MAX_TEXTE,
  lireDemande,
  OUTILS_LIA_HUB,
  TAILLE_MAX_CORPS,
} from "../lib/lia/ask";
import { lecteurPeutN3 } from "../lib/lecture";
import { OUTILS } from "../lib/mcp/outils";

const corps = (o: Record<string, unknown>) => JSON.stringify(o);
const BON = { question: "  Quand finit mon bail ?  ", page: "/semaine", source: "batchchef", proprietaire: true };

describe("lireDemande", () => {
  it("accepte la forme du contrat et rogne la question", () => {
    const r = lireDemande(corps(BON));
    expect(r).toEqual({ ok: true, demande: { question: "Quand finit mon bail ?", page: "/semaine", source: "batchchef", proprietaire: true } });
  });

  it("413 au-delà de 8 Ko, mesurés en octets avant le JSON", () => {
    const gros = "é".repeat(TAILLE_MAX_CORPS / 2 + 1);
    const r = lireDemande(gros);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(413);
  });

  it("400 sur un JSON cassé, une question vide ou trop longue, une page ou une source hors forme", () => {
    for (const brut of [
      "pas du json",
      corps({ ...BON, question: "   " }),
      corps({ ...BON, question: "x".repeat(2001) }),
      corps({ ...BON, page: "semaine" }),
      corps({ ...BON, page: "/<script>" }),
      corps({ ...BON, source: "Batch Chef" }),
      corps({ question: "q", proprietaire: true }),
    ]) {
      const r = lireDemande(brut);
      expect(r.ok, brut.slice(0, 40)).toBe(false);
      if (!r.ok) expect(r.status, brut.slice(0, 40)).toBe(400);
    }
  });

  it("⚠ le message d'erreur nomme les champs, jamais la question", () => {
    const r = lireDemande(corps({ ...BON, question: "secret-fictif ".repeat(200), source: "?" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("question");
      expect(r.message).not.toContain("secret-fictif");
    }
  });

  it("⚠ propriétaire seul : absent ou faux, 403 — un invité d'une app n'interroge pas la mémoire", () => {
    for (const p of [undefined, false]) {
      const r = lireDemande(corps({ ...BON, proprietaire: p }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    }
  });

  it("un corps mal formé reste un 400 même sans propriétaire", () => {
    const r = lireDemande(corps({ question: "", source: "hub" }));
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe("composerQuestion et composerReponse", () => {
  it("dit d'où Marc parle, puis sa question", () => {
    expect(composerQuestion({ question: "Salut", source: "hub" })).toBe("(Marc te parle depuis l'accueil du hub. Réponds court.)\n\nSalut");
    expect(composerQuestion({ question: "Salut", source: "carai", page: "/recharges" })).toContain("l'app carai, page /recharges");
  });

  it("les citations deviennent absolues : relatives, elles ne mènent nulle part depuis une autre app", () => {
    const id = "0f0e0d0c-0b0a-4908-8706-050403020100";
    const r = composerReponse(`Ton bail finit le 2030-01-31 [→/fait/${id}].`, "https://memoryai.example.com");
    expect(r).toEqual({ text: `Ton bail finit le 2030-01-31 [→https://memoryai.example.com/fait/${id}].` });
  });

  it("une réponse vide n'est pas une réponse ; une trop longue est bornée au contrat", () => {
    expect(composerReponse("   ", "https://m")).toBeNull();
    const r = composerReponse("a".repeat(LONGUEUR_MAX_TEXTE + 50), "https://m")!;
    expect(r.text.length).toBe(LONGUEUR_MAX_TEXTE);
  });
});

describe("ce que LIA peut faire depuis le hub", () => {
  it("les outils offerts existent tous et n'écrivent pas", () => {
    const noms = new Set(OUTILS.map((o) => o.name));
    for (const o of OUTILS_LIA_HUB) expect(noms.has(o as `memoryai_${string}`), o).toBe(true);
    for (const ecrit of ["memoryai_proposer", "memoryai_demander", "memoryai_consigner"]) expect(OUTILS_LIA_HUB.has(ecrit), ecrit).toBe(false);
  });

  it("les conversations lui sont fermées : tout appel échoue au lieu d'écrire", async () => {
    await expect(CONVERSATIONS_FERMEES.demarrer("memoryai", new Date())).rejects.toThrow(/fermées/);
    await expect(CONVERSATIONS_FERMEES.parId("x")).rejects.toThrow(/fermées/);
    await expect(CONVERSATIONS_FERMEES.consigner("x", [], undefined as never, new Date())).rejects.toThrow(/fermées/);
  });

  it("⚠ le niveau 3 lui reste fermé : son lecteur n'est pas sur la liste blanche", () => {
    expect(lecteurPeutN3(LECTEUR_LIA_HUB)).toBe(false);
  });

  it("la route n'ouvre jamais N2 ni N3", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/api/ask/route.ts", "utf8");
    expect(src).toContain("inclureN2: false");
    expect(src).toContain("inclureN3: false");
    expect(src).toContain("outilsPermis: OUTILS_LIA_HUB");
  });
});

describe("la route POST /api/ask, avant tout appel au modèle", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const URL_ASK = "https://memoryai.example.com/api/ask";
  const requete = (jeton: string | null, brut = corps(BON)) =>
    new Request(URL_ASK, { method: "POST", body: brut, headers: jeton ? { "x-hub-token": jeton } : {} });

  it("503 sans HUB_TOKEN, 401 sans jeton ou avec un faux", async () => {
    const route = await import("../app/api/ask/route");
    vi.stubEnv("HUB_TOKEN", "");
    expect((await route.POST(requete("nimporte"))).status).toBe(503);
    vi.stubEnv("HUB_TOKEN", "jeton-du-hub-fictif-0123456789");
    expect((await route.POST(requete(null))).status).toBe(401);
    const faux = await route.POST(requete("jeton-faux-fictif-0123456789"));
    expect(faux.status).toBe(401);
    expect(faux.headers.get("cache-control")).toBe("no-store");
  });

  it("bon jeton : 503 gelée, puis 413, 400, 403 selon le corps", async () => {
    const route = await import("../app/api/ask/route");
    const J = "jeton-du-hub-fictif-0123456789";
    vi.stubEnv("HUB_TOKEN", J);
    vi.stubEnv("MEMORYAI_GEL", "1");
    expect((await route.POST(requete(J))).status).toBe(503);
    vi.stubEnv("MEMORYAI_GEL", "");
    expect((await route.POST(requete(J, "x".repeat(TAILLE_MAX_CORPS + 1)))).status).toBe(413);
    expect((await route.POST(requete(J, "{")))).toHaveProperty("status", 400);
    expect((await route.POST(requete(J, corps({ ...BON, proprietaire: false }))))).toHaveProperty("status", 403);
  });

  it("bon jeton, bon corps, rien de configuré : 503 nommé, jamais une réponse inventée", async () => {
    const route = await import("../app/api/ask/route");
    const J = "jeton-du-hub-fictif-0123456789";
    vi.stubEnv("HUB_TOKEN", J);
    vi.stubEnv("MEMORYAI_CHIFFREMENT", "");
    const r = await route.POST(requete(J));
    expect(r.status).toBe(503);
    const b = (await r.json()) as { error: string; text?: string };
    expect(b.text).toBeUndefined();
  });
});
