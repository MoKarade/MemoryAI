// tests/sauvetageOracle.test.ts — joindre l'ancien déploiement, et fermer les écritures (ADR 0019).
//
// L'oracle part avec une session de Marc et un secret : ce qui se prouve ici, c'est qu'il ne
// les envoie qu'à une adresse permise, que la session est bien celle que l'ancien déploiement
// lira, et qu'un refus ou une panne ne rendent jamais un corps. Données FICTIVES.

import { describe, it, expect } from "vitest";
import { decode } from "next-auth/jwt";
import { COOKIE_SESSION, configOracle, oracleAncienDeploiement, sessionDeMarc, type ConfigOracle } from "@/lib/sauvetage/oracle";
import { reponseSauvetage } from "@/lib/sauvetage/porte";

const ENV = {
  MEMORYAI_SAUVETAGE_SOURCE: "https://memory-0abc1234x-mokarades-projects.vercel.app/",
  VERCEL_AUTOMATION_BYPASS_SECRET: "contournement-fictif",
  AUTH_SECRET: "secret-de-session-fictif-assez-long-pour-hkdf",
  AUTHORIZED_EMAIL: "proprietaire@example.com",
};
const CONFIG: ConfigOracle = {
  source: "https://memory-0abc1234x-mokarades-projects.vercel.app",
  contournement: ENV.VERCEL_AUTOMATION_BYPASS_SECRET,
  authSecret: ENV.AUTH_SECRET,
  email: ENV.AUTHORIZED_EMAIL,
};
const ID = "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e";

describe("les réglages de l'oracle", () => {
  it("rend la configuration, adresse sans barre finale", () => {
    expect(configOracle(ENV)).toEqual({ ok: true, config: CONFIG });
  });

  it("nomme ce qui manque, jamais une valeur", () => {
    expect(configOracle({})).toEqual({
      ok: false,
      manque: ["MEMORYAI_SAUVETAGE_SOURCE", "VERCEL_AUTOMATION_BYPASS_SECRET", "AUTH_SECRET", "AUTHORIZED_EMAIL"],
    });
  });

  it("refuse toute adresse qui n'est pas un déploiement du projet en HTTPS : la session n'y partirait pas", () => {
    for (const source of [
      "http://memory-0abc1234x-mokarades-projects.vercel.app",
      "https://memory-0abc1234x-mokarades-projects.vercel.app.exemple.test",
      "https://exemple.test",
      "https://autre-0abc1234x-mokarades-projects.vercel.app",
      "https://memory-0abc1234x-autre-equipe.vercel.app",
      // L'alias de production : il servirait le NOUVEAU déploiement, pas l'ancien.
      "https://memory-ai-mokarades-projects.vercel.app",
    ]) {
      const r = configOracle({ ...ENV, MEMORYAI_SAUVETAGE_SOURCE: source });
      expect(r.ok ? [] : r.manque).toEqual(["MEMORYAI_SAUVETAGE_SOURCE"]);
    }
  });
});

describe("la session fabriquée", () => {
  it("est celle qu'Auth.js relira, pour le propriétaire, sous le même secret et le même nom de cookie", async () => {
    const jeton = await sessionDeMarc(CONFIG);
    const lu = await decode({ token: jeton, secret: CONFIG.authSecret, salt: COOKIE_SESSION });
    expect(lu?.email).toBe(CONFIG.email);
    // Un autre secret ne la lit pas : c'est bien `AUTH_SECRET` qui la signe.
    await expect(decode({ token: jeton, secret: "autre-secret-fictif", salt: COOKIE_SESSION })).rejects.toThrow();
  });
});

describe("l'oracle", () => {
  type Appel = { url: string; init: RequestInit | undefined };
  const repondre = (status: number, corps = "") => {
    const appels: Appel[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      appels.push({ url: String(url), init });
      return new Response(corps, { status });
    }) as typeof fetch;
    return { appels, oracle: oracleAncienDeploiement(CONFIG, f) };
  };

  it("demande la page avec le contournement et la session, sans suivre de redirection", async () => {
    const { appels, oracle } = repondre(200, "<html>page</html>");
    expect(await oracle.fait(ID)).toEqual({ ok: true, html: "<html>page</html>" });
    expect(await oracle.piece(ID)).toEqual({ ok: true, html: "<html>page</html>" });
    expect(appels.map((a) => a.url)).toEqual([`${CONFIG.source}/fait/${ID}`, `${CONFIG.source}/pieces/${ID}`]);
    const entetes = appels[0]!.init!.headers as Record<string, string>;
    expect(entetes["x-vercel-protection-bypass"]).toBe(CONFIG.contournement);
    expect(entetes.cookie?.startsWith(`${COOKIE_SESSION}=`)).toBe(true);
    expect(appels[0]!.init!.redirect).toBe("manual");
    // Une session par oracle, réutilisée tant qu'elle vit.
    expect((appels[1]!.init!.headers as Record<string, string>).cookie).toBe(entetes.cookie);
  });

  it("une redirection ou un 401/403 est un refus ; un 404 est introuvable ; le reste est une panne — jamais un corps", async () => {
    for (const [status, raison] of [[302, "refus"], [307, "refus"], [401, "refus"], [403, "refus"], [404, "introuvable"], [500, "panne"]] as const) {
      expect(await repondre(status, "corps à ne pas rendre").oracle.fait(ID)).toEqual({ ok: false, raison });
    }
  });

  it("une coupure réseau est une panne, et sa cause n'est pas rendue", async () => {
    const oracle = oracleAncienDeploiement(CONFIG, (async () => {
      throw new Error(`connexion refusée vers ${CONFIG.source} avec ${CONFIG.contournement}`);
    }) as typeof fetch);
    expect(await oracle.fait(ID)).toEqual({ ok: false, raison: "panne" });
  });

  it("un identifiant de fait mal formé ne part pas", async () => {
    const { appels, oracle } = repondre(200);
    expect(await oracle.fait("../api/etat")).toEqual({ ok: false, raison: "introuvable" });
    expect(appels).toEqual([]);
  });
});

describe("les écritures fermées", () => {
  it("rendent un 503 qui dit pourquoi, sans cache", async () => {
    const r = reponseSauvetage();
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toMatchObject({ error: "sauvetage_en_cours" });
  });
});
