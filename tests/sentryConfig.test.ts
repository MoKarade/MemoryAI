// tests/sentryConfig.test.ts — verrou de la configuration Sentry (tâche #127).
//
// Trois promesses : sans DSN rien ne part (le build et la CI n'ont besoin d'aucune variable) ;
// même avec un DSN aucune donnée personnelle ne part ; et MemoryAI va plus loin que le modèle
// d'app-template — le TEXTE des erreurs ne part pas non plus, parce qu'une erreur de base
// recopie la requête et ses paramètres dans son message.
//
// Les mutations qui doivent rougir sont nommées dans les titres.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MESSAGE_RETIRE, optionsSentry, retirerDonneesPersonnelles } from "@/lib/sentryConfig";

const lire = (chemin: string): string => readFileSync(join(process.cwd(), chemin), "utf8");

describe("optionsSentry", () => {
  it("est éteint sans DSN (absent, vide ou en blancs)", () => {
    for (const dsn of [undefined, "", "   "]) {
      const options = optionsSentry(dsn);
      expect(options.enabled, `dsn = ${JSON.stringify(dsn)}`).toBe(false);
      expect(options.dsn).toBeUndefined();
    }
  });

  it("est allumé avec un DSN, sans traces, sans fils d'Ariane ni donnée personnelle par défaut", () => {
    const options = optionsSentry("  https://cle@exemple.invalid/1  ");
    expect(options.enabled).toBe(true);
    expect(options.dsn).toBe("https://cle@exemple.invalid/1");
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
    expect(options.maxBreadcrumbs).toBe(0);
  });
});

describe("retirerDonneesPersonnelles", () => {
  it("retire corps, cookies, en-têtes, chaîne de requête et utilisateur, garde l'adresse de la page", () => {
    const evenement = retirerDonneesPersonnelles({
      request: {
        url: "https://exemple.invalid/page",
        data: { courriel: "fictif@exemple.invalid" },
        cookies: { session: "fictif" },
        headers: { authorization: "fictif", "x-forwarded-for": "203.0.113.7" },
        query_string: "jeton=fictif",
      } as Record<string, unknown>,
      user: { ip_address: "203.0.113.7", email: "fictif@exemple.invalid" },
    });
    expect(evenement.request).toEqual({ url: "https://exemple.invalid/page" });
    expect(evenement).not.toHaveProperty("user");
  });

  it("retire le TEXTE des erreurs (une erreur de base recopie la requête et ses paramètres)", () => {
    const evenement = retirerDonneesPersonnelles({
      message: "Failed query: insert into faits (valeur) values ($1) params: allergie fictive",
      exception: {
        values: [
          { type: "DrizzleQueryError", value: "Failed query: insert ... params: valeur fictive" },
          { type: "Error", value: "La valeur « fictive » est refusée" },
        ],
      },
    });
    expect(evenement.message).toBe(MESSAGE_RETIRE);
    expect(evenement.exception?.values?.map((e) => e.value)).toEqual([MESSAGE_RETIRE, MESSAGE_RETIRE]);
    // Le type reste : c'est lui qui dit QUOI chercher.
    expect(evenement.exception?.values?.map((e) => (e as { type?: string }).type)).toEqual(["DrizzleQueryError", "Error"]);
    expect(JSON.stringify(evenement)).not.toMatch(/fictive|params/);
  });

  it("retire fils d'Ariane, données libres et entrée de journal", () => {
    const evenement = retirerDonneesPersonnelles({
      breadcrumbs: [{ message: "[apprentissage] extraction impossible fictif" }],
      extra: { valeur: "fictive" },
      logentry: { message: "fictif %s", params: ["fictive"] },
    });
    expect(evenement).toEqual({});
  });

  it("accepte un événement sans rien de tout cela", () => {
    expect(retirerDonneesPersonnelles({})).toEqual({});
  });

  it("est bien branché dans les options (beforeSend)", () => {
    const options = optionsSentry("https://cle@exemple.invalid/1");
    const propre = options.beforeSend({ user: { email: "x" }, message: "secret fictif" });
    expect(propre).not.toHaveProperty("user");
    expect(propre.message).toBe(MESSAGE_RETIRE);
  });
});

describe("branchement", () => {
  it("aucun fichier ne réactive l'envoi de données personnelles", () => {
    for (const chemin of ["instrumentation.ts", "lib/sentryConfig.ts", "scripts/sentry-essai.mjs"]) {
      expect(lire(chemin), chemin).not.toMatch(/sendDefaultPii\s*:\s*true/);
    }
  });

  it("le serveur et l'essai passent par optionsSentry, jamais par un réglage libre", () => {
    expect(lire("instrumentation.ts")).toMatch(/Sentry\.init\(optionsSentry\(/);
    expect(lire("scripts/sentry-essai.mjs")).toMatch(/\.\.\.options/);
  });

  it("Sentry reste côté serveur : pas de fichier navigateur, la CSP ne s'ouvre pas", () => {
    const csp = lire("next.config.mjs");
    expect(csp).toContain("\"connect-src 'self'\"");
    expect(csp).not.toMatch(/sentry\.io/);
    expect(() => readFileSync(join(process.cwd(), "instrumentation-client.ts"))).toThrow();
  });

  it("l'essai ne part que sur geste (lancement manuel) et ne lit que le secret du dépôt", () => {
    const flux = lire(".github/workflows/sentry-essai.yml");
    expect(flux).toMatch(/^on:\s*\n\s+workflow_dispatch:/m);
    expect(flux).not.toMatch(/\b(push|pull_request|schedule):/);
    expect(flux).toContain("secrets.SENTRY_DSN");
    expect(flux).toMatch(/timeout-minutes:/);
  });
});
