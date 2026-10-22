// tests/banc.test.ts — le banc de questions de la refonte LIA (MemoryAI#69). Papiers FICTIFS.
import { describe, it, expect } from "vitest";
import { CAPACITES, K_RAPPEL, noterBanc, PAR_CAPACITE, tirerBanc, validerBanc, type PapierBanc, type QuestionBanc } from "@/lib/banc/banc";

/** Un parc fictif assez riche pour chaque capacité : 12 émetteurs, 3 papiers chacun. */
function parc(): PapierBanc[] {
  const papiers: PapierBanc[] = [];
  for (let e = 0; e < 12; e++) {
    for (let i = 0; i < 3; i++) {
      papiers.push({ id: `p${e}-${i}`, type: `releve${e}`, emetteur: `Banque Fictive ${e}`, annee: 2020 + i, dateDocument: `${2020 + i}-0${i + 1}-15` });
    }
  }
  return papiers;
}

describe("le tirage du banc", () => {
  it("tire chaque capacité, 20 % d'abstention au moins, et tient la validation", () => {
    const banc = tirerBanc(parc());
    for (const c of CAPACITES) expect(banc.filter((q) => q.capacite === c).length, c).toBe(PAR_CAPACITE);
    expect(validerBanc(banc)).toEqual([]);
  });

  it("est le même pour le même parc, dans n'importe quel ordre", () => {
    expect(tirerBanc([...parc()].reverse())).toEqual(tirerBanc(parc()));
  });

  it("la réponse d'une question « plus récent » est le papier à la date la plus tardive", () => {
    const q = tirerBanc(parc()).find((x) => x.capacite === "mise-a-jour")!;
    expect(q.attendus).toHaveLength(1);
    expect(q.attendus[0]).toMatch(/-2$/);
  });

  it("une question d'abstention vise une année où le type et l'émetteur n'ont rien", () => {
    const papiers = parc();
    for (const q of tirerBanc(papiers).filter((x) => x.capacite === "abstention")) {
      const annee = Number(q.motsCles.split(" ").at(-1));
      expect(papiers.some((p) => q.motsCles.startsWith(`${p.type} ${p.emetteur}`) && p.annee === annee)).toBe(false);
    }
  });

  it("n'invente rien : un parc sans émetteur ne donne aucune question", () => {
    expect(tirerBanc(parc().map((p) => ({ ...p, emetteur: null })))).toEqual([]);
  });
});

describe("la validation du banc", () => {
  const q = (capacite: QuestionBanc["capacite"], attendus: string[]): QuestionBanc => ({ capacite, question: "?", motsCles: "x", attendus });
  const complet = (): QuestionBanc[] => [q("extraction", ["a"]), q("multi-sources", ["a", "b"]), q("temporel", ["c"]), q("mise-a-jour", ["d"]), q("abstention", [])];

  it("refuse un banc sous 20 % d'abstention", () => {
    const banc = [...complet(), q("extraction", ["e"])];
    expect(validerBanc(banc).join(" ")).toMatch(/abstention 1\/6/);
  });

  it("refuse une abstention qui a une réponse, et une question sans réponse", () => {
    expect(validerBanc([...complet(), q("abstention", ["z"]), q("abstention", [])]).join(" ")).toMatch(/abstention a une réponse/);
    expect(validerBanc([...complet(), q("temporel", []), q("abstention", [])]).join(" ")).toMatch(/« temporel » n'a pas de réponse/);
  });

  it("refuse un banc vide et une capacité manquante", () => {
    expect(validerBanc([])).toEqual(["banc vide"]);
    expect(validerBanc(complet().filter((x) => x.capacite !== "temporel")).join(" ")).toMatch(/aucune question « temporel »/);
  });
});

describe("la note du banc", () => {
  const questions: QuestionBanc[] = [
    { capacite: "extraction", question: "?", motsCles: "a", attendus: ["a"] },
    { capacite: "multi-sources", question: "?", motsCles: "b", attendus: ["b1", "b2"] },
    { capacite: "abstention", question: "?", motsCles: "c", attendus: [] },
    { capacite: "abstention", question: "?", motsCles: "d", attendus: [] },
  ];

  it("compte le rappel dans les k premiers, et l'abstention seulement quand rien n'est rendu", () => {
    const m = noterBanc(questions, [["x", "a"], ["b1", "z"], [], ["bruit"]]);
    expect(m.parCapacite.extraction).toEqual({ questions: 1, rappel: 1 });
    expect(m.parCapacite["multi-sources"]).toEqual({ questions: 1, rappel: 0.5 });
    expect(m.rappel).toBe(0.75);
    expect(m.abstentionCorrecte).toBe(0.5);
    expect(m.k).toBe(K_RAPPEL);
  });

  it("un attendu au-delà du rang k ne compte pas", () => {
    const loin = [...Array.from({ length: K_RAPPEL }, (_, i) => `x${i}`), "a"];
    expect(noterBanc(questions.slice(0, 1), [loin]).rappel).toBe(0);
  });

  it("une capacité sans question vaut null, jamais 0", () => {
    expect(noterBanc(questions.slice(0, 1), [["a"]]).parCapacite.temporel).toEqual({ questions: 0, rappel: null });
  });

  it("refuse un nombre de réponses différent du nombre de questions", () => {
    expect(() => noterBanc(questions, [[]])).toThrow();
  });
});
