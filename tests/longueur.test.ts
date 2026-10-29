// tests/longueur.test.ts — la coupe des réponses longues sans bloc (tâche MemoryAI 444). Données FICTIVES.

import { describe, expect, it } from "vitest";
import { couperSansBloc } from "../lib/lia/longueur";

const ID1 = "11111111-1111-1111-1111-111111111111";
const ID2 = "22222222-2222-2222-2222-222222222222";
const LIEN = "https://drive.google.com/file/d/abcDEF_123/view";
const REMPLI = "Mot ".repeat(40).trim();

describe("couperSansBloc", () => {
  it("une réponse courte reste intacte", () => {
    const t = "Tu as un rendez-vous demain. Il est à 9 h.";
    expect(couperSansBloc(t, 0)).toBe(t);
  });

  it("une réponse longue qui porte un bloc reste intacte", () => {
    const t = `${REMPLI}. ${REMPLI}. ${REMPLI}.`;
    expect(couperSansBloc(t, 1)).toBe(t);
  });

  it("une réponse longue sans bloc est ramenée à ses deux premières phrases", () => {
    const t = `Première idée. Deuxième idée. ${REMPLI}. ${REMPLI}. Fin.`;
    expect(couperSansBloc(t, 0)).toBe("Première idée. Deuxième idée.");
  });

  it("une source citée dans la partie retirée n'est jamais perdue, sans doublon", () => {
    const t = `Un fait [→/fait/${ID1}]. Deux. ${REMPLI} [→/fait/${ID2}] [↗${LIEN}]. Encore [→/fait/${ID1}].`;
    const r = couperSansBloc(t, 0);
    expect(r.startsWith(`Un fait [→/fait/${ID1}]. Deux.`)).toBe(true);
    expect(r).toContain(`[→/fait/${ID2}]`);
    expect(r).toContain(`[↗${LIEN}]`);
    expect(r.split(ID1)).toHaveLength(2);
    expect(r).not.toContain(REMPLI);
  });

  it("la source qui suit le point reste avec sa phrase", () => {
    const t = `Première. [→/fait/${ID1}] Deuxième. ${REMPLI}. ${REMPLI}.`;
    expect(couperSansBloc(t, 0)).toBe(`Première. [→/fait/${ID1}] Deuxième.`);
  });
});
