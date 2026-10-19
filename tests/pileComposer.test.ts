// tests/pileComposer.test.ts — l'ORDRE de la pile et ce qu'une carte montre (ADR 0012). PUR.

import { describe, it, expect } from "vitest";
import {
  avisEnVigueur,
  composerPile,
  PAS_INTERCALAGE,
  rangPiece,
  restantParGenre,
  SEUIL_TITULAIRE_INCERTAIN,
  type AvisEnVigueur,
  type CandidatPiece,
} from "../lib/pile/composer";
import { champsCles, MAX_CHAMPS_CARTE, phraseTitulaire } from "../lib/pile/carte";

const J = "2026-09-24";
const t = (s: string) => new Date(`2026-09-${s}T12:00:00Z`);
const piece = (id: string, o: Partial<CandidatPiece> = {}): CandidatPiece => ({
  id,
  domaine: "02 · Finances",
  titulaireConfiance: null,
  dateEcheance: null,
  creeLe: t("10"),
  ...o,
});
const avis = (genre: AvisEnVigueur["genre"], refId: string, verdict: AvisEnVigueur["verdict"], jour = "20"): AvisEnVigueur => ({
  genre,
  refId,
  verdict,
  avisLe: t(jour),
});

describe("le rang d'un papier : le plus utile d'abord (arbitrage de Marc)", () => {
  it("titulaire incertain > identité (04) > administratif (01) > échéance proche > le reste", () => {
    expect(rangPiece(piece("a", { titulaireConfiance: SEUIL_TITULAIRE_INCERTAIN - 0.01, domaine: "02" }), J)).toBe(0);
    expect(rangPiece(piece("b", { domaine: "04 · Immigration" }), J)).toBe(1);
    expect(rangPiece(piece("c", { domaine: "01 · Administratif" }), J)).toBe(2);
    expect(rangPiece(piece("d", { dateEcheance: "2027-03-01" }), J)).toBe(3);
    expect(rangPiece(piece("e"), J)).toBe(4);
  });

  it("au seuil, le titulaire n'est plus incertain ; SANS titulaire, rien à confirmer", () => {
    expect(rangPiece(piece("a", { titulaireConfiance: SEUIL_TITULAIRE_INCERTAIN }), J)).toBe(4);
    expect(rangPiece(piece("a", { titulaireConfiance: null }), J)).toBe(4);
  });

  it("une échéance PASSÉE ou lointaine ne fait pas monter le papier", () => {
    expect(rangPiece(piece("x", { dateEcheance: "2026-09-01" }), J)).toBe(4);
    expect(rangPiece(piece("x", { dateEcheance: "2028-01-01" }), J)).toBe(4);
    expect(rangPiece(piece("x", { dateEcheance: J }), J)).toBe(3);
  });
});

describe("la pile", () => {
  it("trie les papiers par rang, puis du plus récent au plus ancien", () => {
    const pile = composerPile({
      pieces: [piece("vieux"), piece("recent", { creeLe: t("20") }), piece("passeport", { domaine: "04" }), piece("incertain", { titulaireConfiance: 0.4 })],
      faits: [],
      questions: [],
      avis: [],
      aujourdhui: J,
    });
    expect(pile.map((c) => c.id)).toEqual(["incertain", "passeport", "recent", "vieux"]);
  });

  it(`intercale une déduction ou une question toutes les ${PAS_INTERCALAGE} cartes, et les écoule à la fin`, () => {
    const pile = composerPile({
      pieces: ["p1", "p2", "p3", "p4", "p5", "p6"].map((id, i) => piece(id, { creeLe: t(String(20 - i)) })),
      faits: [{ id: "f1", creeLe: t("20") }],
      questions: [{ id: "q1", creeLe: t("19") }, { id: "q2", creeLe: t("18") }],
      avis: [],
      aujourdhui: J,
    });
    expect(pile.map((c) => c.id)).toEqual(["p1", "p2", "p3", "f1", "p4", "p5", "p6", "q1", "q2"]);
  });

  it("REVUE #73 — CONSOMMÉE carte par carte, comme l'écran : une déduction ou une question toutes les 4", () => {
    // L'écran ne montre que la carte du dessus et recompose à chaque chargement. La première
    // version intercalait selon la POSITION : consommée ainsi, la déduction arrivait en 11ᵉ,
    // après le dernier papier. On rejoue ici exactement ce que l'écran fait.
    const pieces = Array.from({ length: 10 }, (_, k) => piece(`p${k}`, { creeLe: t(String(10 + k)) }));
    const faits = [{ id: "f1", creeLe: t("20") }];
    const questions = [{ id: "q1", creeLe: t("19") }];
    const avisJournal: AvisEnVigueur[] = [];
    const vus: string[] = [];
    for (let tour = 0; tour < 12; tour++) {
      const dessus = composerPile({ pieces, faits: faits.filter((f) => !vus.includes(f.id)), questions: questions.filter((q) => !vus.includes(q.id)), avis: avisJournal, aujourdhui: J })[0];
      if (!dessus) break;
      vus.push(dessus.id);
      avisJournal.push({ genre: dessus.genre, refId: dessus.id, verdict: "vrai", avisLe: new Date(Date.UTC(2026, 8, 24, 12, tour)) });
    }
    expect(vus).toEqual(["p9", "p8", "p7", "f1", "p6", "p5", "p4", "q1", "p3", "p2", "p1", "p0"]);
  });

  it("un « passer » sur un papier compte aussi : la déduction ne recule pas indéfiniment", () => {
    const avisJournal = [0, 1, 2].map((k) => ({ genre: "piece" as const, refId: `x${k}`, verdict: "passe" as const, avisLe: t(String(20 + k)) }));
    const pile = composerPile({ pieces: [piece("a"), piece("b")], faits: [{ id: "f1", creeLe: t("20") }], questions: [], avis: avisJournal, aujourdhui: J });
    expect(pile[0]).toEqual({ genre: "fait", id: "f1" });
  });

  it("sans papier, les déductions et les questions forment toute la pile", () => {
    const pile = composerPile({ pieces: [], faits: [{ id: "f1", creeLe: t("20") }], questions: [{ id: "q1", creeLe: t("19") }], avis: [], aujourdhui: J });
    expect(pile).toEqual([{ genre: "fait", id: "f1" }, { genre: "question", id: "q1" }]);
  });

  it("une carte JUGÉE (vrai ou faux) n'y revient pas ; une carte PASSÉE repart en fin de pile", () => {
    const pile = composerPile({
      pieces: [piece("jugee-vrai"), piece("jugee-faux"), piece("passee"), piece("neuve")],
      faits: [],
      questions: [],
      avis: [avis("piece", "jugee-vrai", "vrai"), avis("piece", "jugee-faux", "faux"), avis("piece", "passee", "passe")],
      aujourdhui: J,
    });
    expect(pile.map((c) => c.id)).toEqual(["neuve", "passee"]);
    expect(restantParGenre(pile, [avis("piece", "passee", "passe")])).toEqual({ piece: 1, fait: 0, question: 0 });
  });

  it("les cartes passées repartent de la plus anciennement passée à la plus récente", () => {
    const pile = composerPile({
      pieces: [piece("a"), piece("b")],
      faits: [],
      questions: [],
      avis: [avis("piece", "a", "passe", "22"), avis("piece", "b", "passe", "21")],
      aujourdhui: J,
    });
    expect(pile.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("le verdict EN VIGUEUR est le plus récent : repasser un avis « faux » en « vrai » le reclasse", () => {
    const m = avisEnVigueur([avis("piece", "x", "faux", "20"), avis("piece", "x", "vrai", "21")]);
    expect(m.get("piece|x")?.verdict).toBe("vrai");
    // Et « passé » APRÈS un jugement remet la carte dans la pile — c'est un changement d'avis.
    const pile = composerPile({ pieces: [piece("x")], faits: [], questions: [], avis: [avis("piece", "x", "vrai", "20"), avis("piece", "x", "passe", "21")], aujourdhui: J });
    expect(pile.map((c) => c.id)).toEqual(["x"]);
  });

  it("un avis sur un FAIT n'écarte pas le papier de même identifiant : le genre fait partie de la clé", () => {
    const pile = composerPile({ pieces: [piece("x")], faits: [], questions: [], avis: [avis("fait", "x", "vrai")], aujourdhui: J });
    expect(pile.map((c) => c.id)).toEqual(["x"]);
  });
});

describe("ce qu'une carte papier montre", () => {
  it("les numéros d'abord, au plus cinq champs, les libres seulement pour compléter", () => {
    const c = champsCles({
      champsStructures: {
        personnes: [{ libelle: "titulaire", valeur: "M. R." }],
        numeros: [{ libelle: "passeport", valeur: "N1" }, { libelle: "dossier", valeur: "N2" }],
        montants: [{ libelle: "droits", valeur: "86 €" }],
      },
      champsLibres: { "lieu de délivrance": "Lille", couleur: "bordeaux" },
    });
    expect(c.map((x) => x.libelle)).toEqual(["passeport", "dossier", "droits", "titulaire", "lieu de délivrance"]);
    expect(c.length).toBe(MAX_CHAMPS_CARTE);
  });

  it("une entrée mal formée est ignorée, jamais rendue « [object Object] »", () => {
    const c = champsCles({ champsStructures: { numeros: [{ libelle: "x", valeur: { a: 1 } }, { libelle: "ok", valeur: "1" }] as never }, champsLibres: null });
    expect(c).toEqual([{ libelle: "ok", valeur: "1" }]);
  });

  it("la phrase du titulaire dit quand la lecture est incertaine", () => {
    expect(phraseTitulaire(null, null)).toBeNull();
    expect(phraseTitulaire("Marc", 0.95)).toBe("Titulaire lu : Marc (95 %)");
    expect(phraseTitulaire("Marc", 0.5)).toContain("incertaine");
  });
});
