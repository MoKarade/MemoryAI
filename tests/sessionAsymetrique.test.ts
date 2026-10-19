// tests/sessionAsymetrique.test.ts — le nouveau cookie signé (plan auth-asym-hubperso,
// phase 1). Aucune clé n'est inventée : la paire ES256 est générée dans ce fichier, comme
// le ferait un attaquant qui ne connaît que la clé PUBLIQUE publiée par le hub.

import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, type JWK } from "jose";
import { identiteNouveauCookie } from "../lib/sessionAsymetrique";

const KID = "test-2026";
const EMISSION = "hubperso.com";
const EMAIL = "marc@example.com";

let clePrivee: CryptoKey;
let clesPubliques: { keys: JWK[] };
let env: Record<string, string>;

beforeAll(async () => {
  const paire = await generateKeyPair("ES256", { extractable: true });
  clePrivee = paire.privateKey;
  const jwkPublique = await exportJWK(paire.publicKey);
  clesPubliques = { keys: [{ ...jwkPublique, kid: KID, alg: "ES256", use: "sig" }] };
  env = {
    AUTHORIZED_EMAIL: EMAIL,
    HUB_SESSION_PUBLIC_KEYS: JSON.stringify(clesPubliques),
  };
});

/** Un jeton ES256 valide, avec des champs surchargeables pour fabriquer les cas limites. */
function jetonValide(overrides: {
  email?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  kid?: string;
  cle?: CryptoKey;
}): Promise<string> {
  const maintenant = Math.floor(Date.now() / 1000);
  const charge = {
    email: overrides.email ?? EMAIL,
    iat: overrides.iat ?? maintenant,
    exp: overrides.exp ?? maintenant + 3600,
    iss: overrides.iss ?? EMISSION,
  };
  return new SignJWT(charge)
    .setProtectedHeader({ alg: "ES256", kid: overrides.kid ?? KID })
    .sign(overrides.cle ?? clePrivee);
}

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

describe("identiteNouveauCookie — plan auth-asym-hubperso, phase 1", () => {
  it("rend null quand le cookie est absent", async () => {
    expect(await identiteNouveauCookie(undefined, env)).toBeNull();
    expect(await identiteNouveauCookie("", env)).toBeNull();
  });

  it("rend null quand les clés publiques ne sont pas configurées", async () => {
    const jeton = await jetonValide({});
    expect(await identiteNouveauCookie(jeton, { AUTHORIZED_EMAIL: EMAIL })).toBeNull();
  });

  it("accepte un jeton ES256 valide, signé par la bonne clé, pour l'adresse autorisée", async () => {
    const jeton = await jetonValide({});
    expect(await identiteNouveauCookie(jeton, env)).toEqual({ email: EMAIL });
  });

  it("refuse une signature invalide (jeton signé par une AUTRE clé privée, même kid)", async () => {
    const { privateKey: autreClePrivee } = await generateKeyPair("ES256", { extractable: true });
    const jeton = await jetonValide({ cle: autreClePrivee });
    expect(await identiteNouveauCookie(jeton, env)).toBeNull();
  });

  it("refuse l'algorithme `none` (jeton non signé)", async () => {
    const charge = { email: EMAIL, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, iss: EMISSION };
    const jetonAlgNone = `${b64({ alg: "none", kid: KID })}.${b64(charge)}.`;
    expect(await identiteNouveauCookie(jetonAlgNone, env)).toBeNull();
  });

  it("refuse la confusion d'algorithme (HS256 signé avec la clé PUBLIQUE comme secret)", async () => {
    const secret = new TextEncoder().encode(JSON.stringify(clesPubliques.keys[0]));
    const maintenant = Math.floor(Date.now() / 1000);
    const jetonConfusion = await new SignJWT({
      email: EMAIL,
      iat: maintenant,
      exp: maintenant + 3600,
      iss: EMISSION,
    })
      .setProtectedHeader({ alg: "HS256", kid: KID })
      .sign(secret);
    expect(await identiteNouveauCookie(jetonConfusion, env)).toBeNull();
  });

  it("refuse un jeton expiré", async () => {
    const jeton = await jetonValide({ iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 3600 });
    expect(await identiteNouveauCookie(jeton, env)).toBeNull();
  });

  it("refuse une adresse hors accès, même avec une signature valide", async () => {
    const jeton = await jetonValide({ email: "autre@example.com" });
    expect(await identiteNouveauCookie(jeton, env)).toBeNull();
  });
});
