// tests/pileBandeau.test.ts — le bandeau « à juger » de l'accueil (MemoryAI#90).
//
// Avant : le lien vers `/questions` ne s'affichait que s'il restait une QUESTION ouverte ; un
// papier lu ou une déduction à juger ne comptaient pas. Le compte vient maintenant de la pile
// (`composerPile` + `restantParGenre`).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bandeauAJuger } from "../lib/pile/bandeau";
import { composerPile, restantParGenre, type AvisEnVigueur, type CandidatPiece } from "../lib/pile/composer";

const J = "2026-10-15";
const t = (jour: string) => new Date(`2026-10-${jour}T12:00:00Z`);
const piece = (id: string): CandidatPiece => ({ id, domaine: "02 · Finances", titulaireConfiance: null, dateEcheance: null, creeLe: t("10") });

/** Exactement ce que fait `app/page.tsx` : composer, compter, résumer. */
function bandeau(p: {
  pieces?: CandidatPiece[];
  faits?: { id: string; creeLe: Date }[];
  questions?: { id: string; creeLe: Date }[];
  avis?: AvisEnVigueur[];
}) {
  const avis = p.avis ?? [];
  const ordre = composerPile({ pieces: p.pieces ?? [], faits: p.faits ?? [], questions: p.questions ?? [], avis, aujourdhui: J });
  return bandeauAJuger(restantParGenre(ordre, avis));
}

describe("le bandeau « à juger » suit la pile, pas les seules questions", () => {
  it("0 question ouverte et 1 papier lu non jugé : le bandeau s'affiche", () => {
    const b = bandeau({ pieces: [piece("p1")] });
    expect(b).not.toBeNull();
    expect(b?.titre).toBe("1 à juger");
    expect(b?.detail).toBe("1 papier lu");
  });

  it("une pile vide : aucun bandeau", () => {
    expect(bandeau({})).toBeNull();
  });

  it("papier, déduction et questions s'additionnent, et le détail les nomme", () => {
    const b = bandeau({
      pieces: [piece("p1"), piece("p2")],
      faits: [{ id: "f1", creeLe: t("11") }],
      questions: [{ id: "q1", creeLe: t("12") }, { id: "q2", creeLe: t("13") }],
    });
    expect(b?.total).toBe(5);
    expect(b?.titre).toBe("5 à juger");
    expect(b?.detail).toBe("2 papiers lus, 1 déduction, 2 questions");
  });

  it("une carte déjà jugée ne compte plus : tout jugé = plus de bandeau", () => {
    const avis: AvisEnVigueur[] = [{ genre: "piece", refId: "p1", verdict: "vrai", avisLe: t("14") }];
    expect(bandeau({ pieces: [piece("p1")], avis })).toBeNull();
  });

  it("une carte PASSÉE ne compte pas non plus (comme l'écran de la pile)", () => {
    const avis: AvisEnVigueur[] = [{ genre: "piece", refId: "p1", verdict: "passe", avisLe: t("14") }];
    expect(bandeau({ pieces: [piece("p1")], avis })).toBeNull();
  });

  it("une carte passée à côté d'une carte neuve : seule la neuve est « à juger »", () => {
    const avis: AvisEnVigueur[] = [{ genre: "piece", refId: "p1", verdict: "passe", avisLe: t("14") }];
    expect(bandeau({ pieces: [piece("p1"), piece("p2")], avis })?.titre).toBe("1 à juger");
  });
});

describe("app/page.tsx ne compte plus la pile", () => {
  const src = readFileSync("app/page.tsx", "utf8");
  // Ancré sur des APPELS, jamais sur le nom nu : le fichier parle de lui-même en commentaire.
  // Marc ne juge plus rien (25/10/2026, tâche MemoryAI 231) : l'accueil ne compose ni ne compte
  // plus la pile, et n'affiche donc plus aucun bandeau « à juger ».
  it("ne compte plus la pile : ni resteAJuger(, ni bandeauAJuger(", () => {
    expect(src).not.toContain("resteAJuger(");
    expect(src).not.toContain("bandeauAJuger(");
    expect(readFileSync("app/memoire/page.tsx", "utf8")).not.toContain("resteAJuger(");
  });
  it("n'appelle plus le compte des seules questions ouvertes", () => {
    expect(src).not.toMatch(/\.comptes\(\)/);
    expect(src).not.toMatch(/questions\.ouvertes\s*>/);
  });
});
