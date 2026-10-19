// tests/journal.test.ts — la chaîne tient, et elle dit OÙ elle casse.

import { describe, it, expect } from "vitest";
import {
  ClefJournalAbsenteError,
  cleJournalDepuisEnv,
  signerEntree,
  verifierChaine,
  type EntreeASigner,
  type EntreeSignee,
} from "../lib/journal";

const cle = Buffer.from("une-cle-de-journal-de-test-assez-longue-0123456789");

function entree(i: number, extra: Partial<EntreeASigner> = {}): EntreeASigner {
  return {
    version: 1,
    ts: `2026-09-15T18:00:0${i}Z`,
    lecteur: "claude-ai",
    outil: "memoryai_contexte",
    usage: "conversation",
    niveauMaxServi: 1,
    idsFaits: [`f${i}`],
    questionEmpreinte: null,
    ...extra,
  };
}

function chaine(n: number): EntreeSignee[] {
  const out: EntreeSignee[] = [];
  let prec: string | null = null;
  for (let i = 0; i < n; i++) {
    const s = signerEntree(cle, prec, entree(i));
    out.push(s);
    prec = s.hmac;
  }
  return out;
}

describe("cleJournalDepuisEnv", () => {
  it("exige MEMORYAI_JOURNAL_CLE d'au moins 32 caractères", () => {
    expect(() => cleJournalDepuisEnv({})).toThrow(ClefJournalAbsenteError);
    expect(() => cleJournalDepuisEnv({ MEMORYAI_JOURNAL_CLE: "court" })).toThrow(ClefJournalAbsenteError);
    expect(cleJournalDepuisEnv({ MEMORYAI_JOURNAL_CLE: "x".repeat(32) }).length).toBe(32);
  });
});

describe("chaîne HMAC", () => {
  it("une chaîne intacte vérifie (-1), vide comprise", () => {
    expect(verifierChaine(cle, [])).toBe(-1);
    expect(verifierChaine(cle, chaine(5))).toBe(-1);
  });

  it("une entrée MODIFIÉE est désignée par son index", () => {
    const c = chaine(4);
    c[2] = { ...c[2]!, niveauMaxServi: 3 };
    expect(verifierChaine(cle, c)).toBe(2);
  });

  it("une entrée SUPPRIMÉE casse la chaîne à l'entrée suivante", () => {
    const c = chaine(4);
    c.splice(1, 1);
    expect(verifierChaine(cle, c)).toBe(1);
  });

  it("une entrée INSÉRÉE avec un hmac inventé est désignée", () => {
    const c = chaine(3);
    c.splice(1, 0, { ...entree(9), hmacPrecedent: c[0]!.hmac, hmac: "0".repeat(64) });
    expect(verifierChaine(cle, c)).toBe(1);
  });

  it("une autre clé ne vérifie rien", () => {
    expect(verifierChaine(Buffer.from("y".repeat(40)), chaine(2))).toBe(0);
  });

  it("la première entrée porte hmacPrecedent = null", () => {
    expect(chaine(1)[0]!.hmacPrecedent).toBeNull();
    expect(chaine(2)[1]!.hmacPrecedent).toBe(chaine(2)[0]!.hmac);
  });
});

describe("ADR 0014 — le corpus v1 (historique) est FIGÉ, jamais retouché", () => {
  it("RÉGRESSION : le hmac d'une entrée v1 reste EXACTEMENT celui d'avant le versionnement", () => {
    // Capturé avec le code EN VIGUEUR avant l'ADR 0014 (une seule fois, `signerEntree` sans
    // notion de version). Si ce test rougit, une ligne déjà en base ne se vérifierait plus —
    // c'est la garde qui compte le plus dans tout ce fichier.
    const e: EntreeASigner = {
      version: 1,
      ts: "2026-09-15T18:00:00Z",
      lecteur: "claude-ai",
      outil: "memoryai_contexte",
      usage: "conversation",
      niveauMaxServi: 1,
      idsFaits: ["f0"],
      questionEmpreinte: null,
    };
    expect(signerEntree(cle, null, e).hmac).toBe(
      "1ac404c75b4a3d11c5e176b5d87edad9d53de96bf7139c578395c242ee0618e0",
    );
  });
});

describe("ADR 0014 — le corpus v2 ajoute idsPieces (revue #72 : les papiers lus au journal)", () => {
  it("un papier ajouté à idsPieces change le hmac — v2 le signe réellement", () => {
    const sans = signerEntree(cle, null, entree(0, { version: 2, idsPieces: [] }));
    const avec = signerEntree(cle, null, entree(0, { version: 2, idsPieces: ["p1"] }));
    expect(sans.hmac).not.toBe(avec.hmac);
  });

  it("DOMAINE-SÉPARATION : v1 et v2 de la MÊME entrée (idsPieces vide) ne collisionnent jamais", () => {
    // Point de pole-securite (29/09) : ne pas compter SEULEMENT sur la longueur différente du
    // corpus — `version` figure en clair, en tête des champs propres à l'entrée.
    const v1 = signerEntree(cle, null, entree(0, { version: 1 }));
    const v2 = signerEntree(cle, null, entree(0, { version: 2, idsPieces: [] }));
    expect(v1.hmac).not.toBe(v2.hmac);
  });

  it("une chaîne mixte v1 puis v2 vérifie normalement — la migration ne casse rien", () => {
    let prec: string | null = null;
    const out: EntreeSignee[] = [];
    for (const v of [1, 2, 2] as const) {
      const s = signerEntree(cle, prec, entree(out.length, { version: v, idsPieces: v === 2 ? [] : undefined }));
      out.push(s);
      prec = s.hmac;
    }
    expect(verifierChaine(cle, out)).toBe(-1);
  });

  it("MUTATION — une chaîne dont la version REDESCEND (v2 puis v1) est REJETÉE, pas seulement le hmac", () => {
    // Le point adversarial de pole-securite : chaque signature ci-dessous est
    // INDIVIDUELLEMENT valide (chacune signée avec le bon corpus pour SA version) — sans une
    // règle de monotonie explicite dans `verifierChaine`, rien d'autre ne détecterait la
    // régression. Retirer cette règle laisse ce test vert par accident (verifierChaine
    // rendrait -1) : c'est le signe que la garde a disparu.
    let prec: string | null = null;
    const out: EntreeSignee[] = [];
    for (const v of [2, 1] as const) {
      const s = signerEntree(cle, prec, entree(out.length, { version: v, idsPieces: v === 2 ? [] : undefined }));
      out.push(s);
      prec = s.hmac;
    }
    expect(verifierChaine(cle, out)).toBe(1);
  });
});
