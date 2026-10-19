// tests/graphe.test.ts — les cinq règles de l'ADR 0002 §5.3, une par une.
//
// Ce qui est vérifié ici n'est pas « ça produit des liens » mais ce que chaque règle
// AFFIRME : qu'elle lie ce qu'elle doit lier, qu'elle ne lie PAS ce qui se ressemble sans
// rapport, que les règles orientées gardent leur sens, et qu'elle s'ABSTIENT bruyamment
// plutôt que de produire un mur de liens.

import { describe, it, expect } from "vitest";
import {
  calculerLiens,
  normaliserAttribut,
  parType,
  REGLES_ORIENTEES,
  seChevauchent,
  TAILLE_MAX_GROUPE,
  type FaitPourGraphe,
} from "../lib/graphe";
import { TYPES_LIEN } from "../lib/db/schema";

function fait(p: Partial<FaitPourGraphe> & { id: string }): FaitPourGraphe {
  return {
    domaine: "emploi",
    predicat: "emploi.employeur",
    valeurType: "texte",
    valeur: "",
    attributs: null,
    valideDe: null,
    valideA: null,
    remplaceId: null,
    ...p,
  };
}

describe("les types de lien du code et ceux de la base disent la même chose", () => {
  it("aucune règle ne peut exister sans sa colonne, ni l'inverse", () => {
    // Deux listes qui décrivent le même ensemble finissent par diverger : celle-ci les
    // confronte. Un type ajouté d'un seul côté échouerait ici avant d'échouer en base.
    const calcules = new Set(
      calculerLiens(
        [
          fait({ id: "a", valeurType: "ref_document", valeur: "doc1" }),
          fait({ id: "b", valeurType: "ref_document", valeur: "doc1" }),
          fait({ id: "c", domaine: "logement", valideDe: "2026-01-01" }),
          fait({ id: "d", valideDe: "2026-02-01", remplaceId: "c" }),
          fait({ id: "e", attributs: { emetteur: "Revenu Québec" } }),
          fait({ id: "f", attributs: { emetteur: "revenu quebec" } }),
        ],
        [{ id: "q1", question: "Quand finit ton bail ?", faitId: "e" }],
      ).liens.map((l) => l.type),
    );
    // Les cinq règles de la v1 sont toutes atteignables par ce corpus : si l'une cessait de
    // l'être, on la croirait vivante sans qu'aucun test ne la joue.
    expect([...calcules].sort()).toEqual([...TYPES_LIEN].sort());
  });
});

describe("meme-document", () => {
  it("lie deux faits qui pointent le même fichier", () => {
    const { liens } = calculerLiens([
      fait({ id: "a", valeurType: "ref_document", valeur: "1AbC" }),
      fait({ id: "b", valeurType: "ref_document", valeur: "1AbC" }),
    ]);
    const l = liens.filter((x) => x.type === "meme-document");
    expect(l).toHaveLength(1);
    expect([l[0]?.faitA, l[0]?.faitB]).toEqual(["a", "b"]);
  });

  it("ne lie PAS deux faits dont la valeur se ressemble mais n'est pas un pointeur", () => {
    // Le point de la règle : un identifiant, jamais une ressemblance de texte.
    const { liens } = calculerLiens([
      fait({ id: "a", valeurType: "texte", valeur: "1AbC" }),
      fait({ id: "b", valeurType: "texte", valeur: "1AbC" }),
    ]);
    expect(liens.filter((x) => x.type === "meme-document")).toHaveLength(0);
  });

  it("le pourquoi ne recopie jamais une valeur de fait — il n'est pas chiffré", () => {
    const { liens } = calculerLiens([
      fait({ id: "a", valeurType: "ref_document", valeur: "1AbC", attributs: { emetteur: "Secret" } }),
      fait({ id: "b", valeurType: "ref_document", valeur: "1AbC", attributs: { emetteur: "Secret" } }),
    ]);
    const doc = liens.find((x) => x.type === "meme-document");
    expect(doc?.pourquoi).toContain("même document");
  });
});

describe("meme-periode", () => {
  it("lie deux DOMAINES différents dont les périodes se chevauchent", () => {
    const { liens } = calculerLiens([
      fait({ id: "a", domaine: "emploi", valideDe: "2026-01-01", valideA: "2026-12-31" }),
      fait({ id: "b", domaine: "logement", valideDe: "2026-06-01", valideA: null }),
    ]);
    expect(liens.filter((x) => x.type === "meme-periode")).toHaveLength(1);
  });

  it("ne lie PAS deux faits du même domaine — ce serait le cas ordinaire, pas une trouvaille", () => {
    const { liens } = calculerLiens([
      fait({ id: "a", domaine: "emploi", valideDe: "2026-01-01" }),
      fait({ id: "b", domaine: "emploi", valideDe: "2026-02-01" }),
    ]);
    expect(liens.filter((x) => x.type === "meme-periode")).toHaveLength(0);
  });

  it("deux faits SANS aucune date ne se chevauchent pas — sinon tout serait lié à tout", () => {
    expect(seChevauchent({ valideDe: null, valideA: null }, { valideDe: "2026-01-01", valideA: null })).toBe(false);
    expect(seChevauchent({ valideDe: null, valideA: null }, { valideDe: null, valideA: null })).toBe(false);
  });

  it("une borne absente est OUVERTE, pas « fini aujourd'hui »", () => {
    // Un emploi commencé en 2020 et toujours en cours chevauche un logement de 2026.
    expect(seChevauchent({ valideDe: "2020-01-01", valideA: null }, { valideDe: "2026-01-01", valideA: "2026-12-31" })).toBe(true);
    // Et deux périodes disjointes ne se chevauchent pas, borne ouverte ou non.
    expect(seChevauchent({ valideDe: "2020-01-01", valideA: "2021-01-01" }, { valideDe: "2026-01-01", valideA: null })).toBe(false);
  });

  it("s'abstient bruyamment quand il y a trop de faits datés", () => {
    const beaucoup = Array.from({ length: TAILLE_MAX_GROUPE * 4 + 1 }, (_, i) =>
      fait({ id: `f${i}`, domaine: i % 2 === 0 ? "emploi" : "logement", valideDe: "2026-01-01" }),
    );
    const r = calculerLiens(beaucoup);
    expect(r.liens.filter((x) => x.type === "meme-periode")).toHaveLength(0);
    expect(r.abstentions.some((a) => a.regle === "meme-periode")).toBe(true);
  });
});

describe("remplacement — orienté", () => {
  it("va du NOUVEAU vers l'ANCIEN, et l'ordre n'est pas normalisé", () => {
    // ⚠️ L'id du nouveau est choisi APRÈS celui de l'ancien dans l'ordre lexicographique :
    // une normalisation de paire inverserait le lien, et le graphe dirait que l'ancien
    // remplace le nouveau. C'est exactement ce que ce cas attrape.
    const { liens } = calculerLiens([fait({ id: "aaa" }), fait({ id: "zzz", remplaceId: "aaa" })]);
    const l = liens.find((x) => x.type === "remplacement");
    expect(l?.faitA).toBe("zzz");
    expect(l?.faitB).toBe("aaa");
  });

  it("ne pose rien quand le remplacé n'est pas dans l'ensemble lu", () => {
    const { liens } = calculerLiens([fait({ id: "b", remplaceId: "disparu" })]);
    expect(liens.filter((x) => x.type === "remplacement")).toHaveLength(0);
  });

  it("les règles orientées sont nommées, et elles seules", () => {
    expect([...REGLES_ORIENTEES].sort()).toEqual(["cause-declaree", "remplacement"]);
  });
});

describe("meme-domaine-meme-entite", () => {
  it("lie deux faits du même domaine partageant un émetteur, accents et casse ignorés", () => {
    const { liens } = calculerLiens([
      fait({ id: "a", domaine: "finances", attributs: { emetteur: "Revenu Québec" } }),
      fait({ id: "b", domaine: "finances", attributs: { emetteur: "  revenu quebec " } }),
    ]);
    expect(liens.filter((x) => x.type === "meme-domaine-meme-entite")).toHaveLength(1);
  });

  it("ne lie PAS le même émetteur dans deux domaines différents", () => {
    const { liens } = calculerLiens([
      fait({ id: "a", domaine: "finances", attributs: { emetteur: "Banque Aurore" } }),
      fait({ id: "b", domaine: "logement", attributs: { emetteur: "Banque Aurore" } }),
    ]);
    expect(liens.filter((x) => x.type === "meme-domaine-meme-entite")).toHaveLength(0);
  });

  it("ignore `annee` et `echeance` — une date partagée n'est pas une entité partagée", () => {
    const { liens } = calculerLiens([
      fait({ id: "a", domaine: "finances", attributs: { annee: "2024" } }),
      fait({ id: "b", domaine: "finances", attributs: { annee: "2024", echeance: "2025-04-30" } }),
      fait({ id: "c", domaine: "finances", attributs: { echeance: "2025-04-30" } }),
    ]);
    expect(liens.filter((x) => x.type === "meme-domaine-meme-entite")).toHaveLength(0);
  });

  it("s'abstient au-delà de la borne, et le DIT au lieu de produire un mur", () => {
    const groupe = Array.from({ length: TAILLE_MAX_GROUPE + 1 }, (_, i) =>
      fait({ id: `f${i}`, domaine: "finances", attributs: { emetteur: "Hydro" } }),
    );
    const r = calculerLiens(groupe);
    expect(r.liens.filter((x) => x.type === "meme-domaine-meme-entite")).toHaveLength(0);
    const a = r.abstentions.find((x) => x.regle === "meme-domaine-meme-entite");
    expect(a?.taille).toBe(TAILLE_MAX_GROUPE + 1);
  });

  it("juste SOUS la borne, la clique est complète", () => {
    const groupe = Array.from({ length: TAILLE_MAX_GROUPE }, (_, i) =>
      fait({ id: `f${i}`, domaine: "finances", attributs: { emetteur: "Hydro" } }),
    );
    const r = calculerLiens(groupe);
    const n = TAILLE_MAX_GROUPE;
    expect(r.liens.filter((x) => x.type === "meme-domaine-meme-entite")).toHaveLength((n * (n - 1)) / 2);
    expect(r.abstentions).toHaveLength(0);
  });

  it("normaliserAttribut ne garde que ce qui identifie", () => {
    expect(normaliserAttribut("  Revenu   QUÉBEC ")).toBe("revenu quebec");
  });
});

describe("cause-declaree — orienté", () => {
  it("va du fait vers la question, et pointe une QUESTION, pas un fait", () => {
    const { liens } = calculerLiens([fait({ id: "f1" })], [{ id: "q1", question: "Ton bail ?", faitId: "f1" }]);
    const l = liens.find((x) => x.type === "cause-declaree");
    expect(l?.faitA).toBe("f1");
    expect(l?.faitB).toBe("q1");
    expect(l?.cibleB).toBe("question");
  });

  it("une question sans réponse ne lie rien", () => {
    const { liens } = calculerLiens([fait({ id: "f1" })], [{ id: "q1", question: "Ton bail ?", faitId: null }]);
    expect(liens).toHaveLength(0);
  });

  it("une question dont le fait a disparu ne lie rien", () => {
    const { liens } = calculerLiens([fait({ id: "f1" })], [{ id: "q1", question: "Ton bail ?", faitId: "parti" }]);
    expect(liens).toHaveLength(0);
  });
});

describe("ce qui vaut pour tous les liens", () => {
  it("aucune boucle : un fait ne se lie pas à lui-même", () => {
    // Un fait qui se déclarerait son propre remplaçant passerait toutes les règles et
    // n'apprendrait rien. La base le refuse aussi (`liens_pas_de_boucle`).
    const { liens } = calculerLiens([fait({ id: "a", remplaceId: "a" })]);
    expect(liens).toHaveLength(0);
  });

  it("aucun doublon (faitA, faitB, type), quel que soit l'ordre de parcours", () => {
    const faits = [
      fait({ id: "b", valeurType: "ref_document", valeur: "doc" }),
      fait({ id: "a", valeurType: "ref_document", valeur: "doc" }),
    ];
    const cles = calculerLiens(faits).liens.map((l) => `${l.faitA}|${l.faitB}|${l.type}`);
    expect(new Set(cles).size).toBe(cles.length);
    // Et l'ordre d'entrée ne change pas le résultat : une règle symétrique normalise.
    const inverse = calculerLiens([...faits].reverse()).liens.map((l) => `${l.faitA}|${l.faitB}|${l.type}`);
    expect(inverse.sort()).toEqual(cles.sort());
  });

  it("le poids dit ce que la règle vaut : un chevauchement pèse moins qu'un pointeur", () => {
    const { liens } = calculerLiens([
      fait({ id: "a", domaine: "emploi", valideDe: "2026-01-01", valeurType: "ref_document", valeur: "d" }),
      fait({ id: "b", domaine: "logement", valideDe: "2026-01-01", valeurType: "ref_document", valeur: "d" }),
    ]);
    const doc = liens.find((l) => l.type === "meme-document");
    const periode = liens.find((l) => l.type === "meme-periode");
    expect(doc?.poids).toBe(1);
    expect(periode?.poids).toBeLessThan(doc?.poids ?? 0);
  });

  it("parType trie par nombre de liens, et chaque groupe par poids décroissant", () => {
    const { liens } = calculerLiens([
      fait({ id: "a", domaine: "emploi", valideDe: "2026-01-01" }),
      fait({ id: "b", domaine: "logement", valideDe: "2026-01-01" }),
      fait({ id: "c", domaine: "sante", valideDe: "2026-01-01" }),
      fait({ id: "d", remplaceId: "a" }),
    ]);
    const groupes = parType(liens);
    expect(groupes[0]?.type).toBe("meme-periode");
    expect(groupes[0]?.liens.length).toBeGreaterThan(groupes[1]?.liens.length ?? 0);
  });

  it("aucune mémoire ⇒ aucun lien, et aucune abstention", () => {
    expect(calculerLiens([])).toEqual({ liens: [], abstentions: [] });
  });
});
