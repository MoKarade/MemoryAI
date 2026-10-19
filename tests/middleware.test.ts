// tests/middleware.test.ts — le garde des pages lit AUSSI le nouveau cookie signé du hub
// (plan auth-asym-hubperso, phase 1), exactement comme `requireSession()` (lib/session.ts).
//
// On teste le vrai `middleware.ts` : `@/auth` est remplacé par une enveloppe transparente
// (`auth(handler)` rend le handler), ce qui laisse le garde, `decideGuard` et la lecture du
// cookie tels qu'en production. La paire ES256 est générée ici : un attaquant ne connaît que
// la clé PUBLIQUE publiée par le hub.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { SignJWT, generateKeyPair, exportJWK } from "jose";

vi.mock("@/auth", () => ({ auth: (handler: unknown) => handler }));
// La configuration d'auth (secret + propriétaire) est pilotée par ce drapeau : le test n'a pas
// à nommer ni à poser de variable secrète, et le cas « non configuré » reste couvert.
const etat = vi.hoisted(() => ({ authConfiguree: true }));
vi.mock("@/lib/authConfigured", () => ({ isAuthConfigured: () => etat.authConfiguree }));

import middleware from "../middleware";
import { NOM_COOKIE_SESSION_HUB } from "../lib/sessionAsymetrique";

const KID = "test-2026";
const EMAIL = "marc@example.com";

type Reponse = Response | undefined;
type Gestionnaire = (req: unknown) => Promise<Reponse> | Reponse;

let clePrivee: CryptoKey;
const ENV_AVANT = { ...process.env };

beforeAll(async () => {
  const paire = await generateKeyPair("ES256", { extractable: true });
  clePrivee = paire.privateKey;
  const jwk = await exportJWK(paire.publicKey);
  process.env.AUTHORIZED_EMAIL = EMAIL;
  process.env.HUB_SESSION_PUBLIC_KEYS = JSON.stringify({
    keys: [{ ...jwk, kid: KID, alg: "ES256", use: "sig" }],
  });
});

afterAll(() => {
  process.env = ENV_AVANT;
});

function jeton(opts: { email?: string; cle?: CryptoKey; exp?: number } = {}): Promise<string> {
  const maintenant = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: opts.email ?? EMAIL,
    iat: maintenant,
    exp: opts.exp ?? maintenant + 3600,
    iss: "hubperso.com",
  })
    .setProtectedHeader({ alg: "ES256", kid: KID })
    .sign(opts.cle ?? clePrivee);
}

/** Une requête minimale : la forme que lit le garde (`auth`, `cookies`, `nextUrl`). */
function requete(chemin: string, opts: { cookie?: string; sessionAuthjs?: boolean } = {}) {
  return {
    auth: opts.sessionAuthjs ? { user: { email: EMAIL } } : null,
    cookies: {
      get: (nom: string) =>
        nom === NOM_COOKIE_SESSION_HUB && opts.cookie ? { name: nom, value: opts.cookie } : undefined,
    },
    nextUrl: new URL(`http://localhost${chemin}`),
  };
}

const garde = middleware as unknown as Gestionnaire;

describe("middleware — nouveau cookie __Secure-hub.session", () => {
  it("laisse passer une page avec une session __Secure-hub.session valide", async () => {
    const reponse = await garde(requete("/", { cookie: await jeton() }));
    expect(reponse).toBeUndefined();
  });

  it("refuse une signature fausse : redirection vers /login pour une page", async () => {
    const { privateKey: autre } = await generateKeyPair("ES256", { extractable: true });
    const reponse = await garde(requete("/", { cookie: await jeton({ cle: autre }) }));
    expect(reponse?.status).toBe(307);
    expect(reponse?.headers.get("location")).toContain("/login");
  });

  it("refuse une signature fausse : 401 JSON pour une route API", async () => {
    const { privateKey: autre } = await generateKeyPair("ES256", { extractable: true });
    const reponse = await garde(requete("/api/faits/liste", { cookie: await jeton({ cle: autre }) }));
    expect(reponse?.status).toBe(401);
  });

  it("refuse une session valide d'une adresse qui n'est PAS le propriétaire", async () => {
    const reponse = await garde(requete("/", { cookie: await jeton({ email: "invite@example.com" }) }));
    expect(reponse?.status).toBe(307);
  });

  it("refuse un jeton expiré", async () => {
    const passe = Math.floor(Date.now() / 1000) - 3600;
    const reponse = await garde(requete("/", { cookie: await jeton({ exp: passe }) }));
    expect(reponse?.status).toBe(307);
  });

  it("refuse quand les clés publiques ne sont pas configurées (échec fermé)", async () => {
    const cles = process.env.HUB_SESSION_PUBLIC_KEYS;
    delete process.env.HUB_SESSION_PUBLIC_KEYS;
    try {
      const reponse = await garde(requete("/", { cookie: await jeton() }));
      expect(reponse?.status).toBe(307);
    } finally {
      process.env.HUB_SESSION_PUBLIC_KEYS = cles;
    }
  });

  it("refuse sans aucun cookie", async () => {
    const reponse = await garde(requete("/"));
    expect(reponse?.status).toBe(307);
  });

  it("garde l'ancien chemin : une session Auth.js valide passe encore", async () => {
    const reponse = await garde(requete("/", { sessionAuthjs: true }));
    expect(reponse).toBeUndefined();
  });

  it("reste fermé (503) sans configuration d'auth, même avec un cookie valide", async () => {
    etat.authConfiguree = false;
    try {
      const reponse = await garde(requete("/", { cookie: await jeton() }));
      expect(reponse?.status).toBe(503);
    } finally {
      etat.authConfiguree = true;
    }
  });
});
