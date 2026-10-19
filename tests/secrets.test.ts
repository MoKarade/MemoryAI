// tests/secrets.test.ts — le scan qui tourne avant le chiffrement des conversations.
//
// ⚠️ CE FICHIER CONTIENT DES SECRETS D'APPARENCE, ET C'EST SON OBJET. Aucun n'est réel :
// chacun est ASSEMBLÉ à l'exécution (`["sk", "ant", …].join("-")`) pour qu'aucune ligne de
// source ne porte un motif complet — leçon du parc, où un garde de vie privée a rougi trois
// fois sur les exemples écrits pour l'illustrer.
//
// Chaque forme a son cas POSITIF et son contrôle NÉGATIF. Un motif sans contre-exemple masque
// du texte ordinaire sans que personne ne le voie : le coût d'un faux positif n'est pas le
// fragment perdu, c'est la conversation devenue illisible et le scan qu'on finit par couper.

import { describe, it, expect } from "vitest";
import { entropie, MARQUE, masquerSecrets, ressembleAUnSecret } from "../lib/conversations/secrets";

const A = (...p: string[]) => p.join("");

describe("masquerSecrets — les formes nommées", () => {
  const cas: [string, string][] = [
    ["clé Anthropic", A("sk-", "ant-", "api03-", "Xy9Zk2mQ4nR7tV1wB8cD3eF6gH0jK5lM")],
    ["clé OpenAI", A("sk-", "proj", "Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1St2Uv3Wx4Yz")],
    ["clé AWS", A("AKIA", "IOSFODNN7EXAMPLE")],
    ["jeton GitHub", A("ghp_", "16C7e42F292c6912E7710c838347Ae178B4a")],
    ["jeton Slack", A("xoxb-", "123456789012-1234567890123-", "aBcDeFgHiJkLmNoPqRsTuVwX")],
    ["clé privée PEM", A("-----BEGIN ", "RSA PRIVATE KEY", "-----")],
    ["JWT", A("eyJ", "hbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NSJ9", ".", "dBjftJeZ4CVPmB92K27u")],
    ["en-tête porteur", A("Bearer ", "ma1.", "AbCdEf0123456789AbCdEf0123456789")],
    ["URL avec mot de passe", A("postgres://", "marc", ":", "motDePasse42", "@", "ep-x.neon.tech/memoire")],
    ["variable d'environnement", A("MEMORYAI_", "CHIFFREMENT", "=", "Zk2mQ4nR7tV1wB8cD3eF6gH0jK5lM9nP")],
  ];

  for (const [nom, secret] of cas) {
    it(`masque : ${nom}`, () => {
      const r = masquerSecrets(`J'ai collé ${secret} dans le terminal.`);
      expect(r.retires, nom).toBeGreaterThanOrEqual(1);
      expect(r.texte, nom).toContain(MARQUE);
      // La valeur ne survit nulle part dans la sortie — ni entière, ni par un fragment long.
      expect(r.texte).not.toContain(secret);
    });
  }

  it("compte CHAQUE fragment, pas chaque message", () => {
    const deux = `${A("AKIA", "IOSFODNN7EXAMPLE")} puis ${A("AKIA", "JOSFODNN7EXAMPLE")}`;
    expect(masquerSecrets(deux).retires).toBe(2);
  });
});

describe("masquerSecrets — les contrôles NÉGATIFS", () => {
  const innocents: [string, string][] = [
    ["une phrase française ordinaire", "Mon bail de logement se termine le 30 juin 2028, et je veux être prévenu avant."],
    ["un mot français très long", "C'est anticonstitutionnellement long comme discussion."],
    ["une URL sans identifiants", "Regarde https://github.com/MoKarade/MemoryAI/pull/10 quand tu peux."],
    ["un chemin de fichier", "Le scan vit dans lib/conversations/secrets.ts, à côté du dépôt."],
    ["un nom de variable SANS valeur", "Il faut poser MEMORYAI_N2_CHAT dans Vercel."],
    ["une date et des nombres", "Le 2026-09-15 à 21:31, quatre requêtes ont répondu 200 et zéro 500."],
    ["une phrase anglaise", "The memory should keep everything and lose nothing, that is the whole point."],
  ];

  for (const [nom, texte] of innocents) {
    it(`laisse intact : ${nom}`, () => {
      const r = masquerSecrets(texte);
      expect(r.retires, `${nom} — masqué à tort`).toBe(0);
      expect(r.texte).toBe(texte);
    });
  }

  it("un identifiant Drive ordinaire (28 caractères) passe : il est déjà dans les faits", () => {
    const fileId = "1AbCdEfGhIjKlMnOpQrStUvWxYz01";
    expect(masquerSecrets(`Le document est en ${fileId}.`).retires).toBe(0);
  });
});

describe("ressembleAUnSecret — la conjonction, jamais l'entropie seule", () => {
  it("exige la longueur", () => {
    expect(ressembleAUnSecret("Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1")).toBe(false);
  });

  it("exige les trois classes de caractères", () => {
    // 40 minuscules : entropie élevée, mais aucune majuscule ni chiffre.
    expect(ressembleAUnSecret("abcdefghijklmnopqrstuvwxyzabcdefghijklmn")).toBe(false);
  });

  it("masque un hexadécimal long SANS condition de classes — un SHA ressemble trop à une clé", () => {
    expect(ressembleAUnSecret("da39a3ee5e6b4b0d3255bfef95601890afd80709")).toBe(true);
  });

  it("l'entropie seule ne suffirait pas : une phrase de 32 caractères l'atteint", () => {
    // Le texte porte des espaces, donc il n'est même pas CANDIDAT — ce cas dit pourquoi le
    // prédicat regarde l'alphabet et les classes avant l'entropie.
    const phrase = "mon bail se termine en juin 2028";
    expect(phrase.length).toBeGreaterThanOrEqual(32);
    expect(entropie(phrase)).toBeGreaterThan(3.5);
    expect(masquerSecrets(phrase).retires).toBe(0);
  });
});
