// tests/agendaBloc.test.ts — l'agenda du jour À L'ÉCRAN (ADR 0029 § 6) : la tuile « Aujourd'hui »
// de « Sa journée » (heure du Québec, durée, heure de lecture, états honnêtes) et le compte rendu
// par GET /api/etat, sans titre. Données FICTIVES : titres et heures inventés.

import { describe, expect, it } from "vitest";
import { dureeAgenda, LIGNES_AGENDA, tableauJournee, type LectureAgenda } from "../lib/accueil/tableaux";
import { composerEtatPublic } from "../lib/etatPublic";

const JOUR = "2026-10-26";

describe("la tuile « Aujourd'hui »", () => {
  const corps = (a: LectureAgenda | null | undefined) => tableauJournee([], undefined, undefined, a).tuiles.find((t) => t.cle === "aujourdhui")?.corps;
  const agenda = (evenements: { debut: Date; dureeMin: number; journeeEntiere: boolean; titre: string }[], illisibles = 0): LectureAgenda => ({ jour: JOUR, luLe: new Date("2026-10-26T11:58:00Z"), evenements, illisibles });

  it("une ligne par événement : l'heure de Québec, le titre, la durée ; puis l'heure de lecture", () => {
    expect(
      corps(
        agenda([
          { debut: new Date("2026-10-26T04:00:00Z"), dureeMin: 1440, journeeEntiere: true, titre: "Congé fictif" },
          { debut: new Date("2026-10-26T13:30:00Z"), dureeMin: 90, journeeEntiere: false, titre: "Réunion fictive" },
        ]),
      ),
    ).toEqual([
      {
        genre: "liste",
        elements: [{ libelle: "Toute la journée · Congé fictif" }, { libelle: "9 h 30 · Réunion fictive", detail: "1 h 30" }],
      },
      { genre: "texte", texte: "Lu par DriveAI aujourd'hui, 7 h 58." },
    ]);
  });

  it("au-delà de huit lignes, elle dit combien suivent ; un titre illisible est compté", () => {
    const n = LIGNES_AGENDA + 3;
    const c = corps(agenda(Array.from({ length: n }, (_, i) => ({ debut: new Date(Date.UTC(2026, 9, 26, 12 + i)), dureeMin: 30, journeeEntiere: false, titre: `Fictif ${i}` })), 2));
    const liste = c?.[0];
    if (liste?.genre !== "liste") throw new Error("liste attendue");
    expect(liste.elements).toHaveLength(LIGNES_AGENDA + 1);
    expect(liste.elements.at(-1)).toEqual({ libelle: "Et 3 autres" });
    expect(c?.[1]).toEqual({ genre: "texte", texte: "Lu par DriveAI aujourd'hui, 7 h 58. 2 titres illisibles, non montrés." });
  });

  it("rien reçu, rien de prévu, base en panne, non lu : chaque cas le dit", () => {
    expect(corps(undefined)).toEqual([{ genre: "vide", texte: "Ton agenda du jour n'est pas encore lu ici." }]);
    expect(corps(null)).toEqual([{ genre: "vide", texte: "La base ne répond pas : ton agenda n'est pas lisible." }]);
    expect(corps("non-recu")).toEqual([{ genre: "vide", texte: "DriveAI n'a pas envoyé ton agenda aujourd'hui." }]);
    expect(corps(agenda([]))).toEqual([
      { genre: "vide", texte: "Rien de prévu aujourd'hui." },
      { genre: "texte", texte: "Lu par DriveAI aujourd'hui, 7 h 58." },
    ]);
  });

  it("les durées se disent en minutes, en heures, ou « sans durée »", () => {
    expect([0, 45, 60, 90, 125].map(dureeAgenda)).toEqual(["sans durée", "45 min", "1 h", "1 h 30", "2 h 05"]);
  });
});

describe("GET /api/etat : l'agenda en nombres", () => {
  it("le compte et l'heure de lecture, jamais un titre ; absent si la route ne l'a pas lu", () => {
    const faits = { parStatut: {}, canaris: 0, migresEnPiece: 0, dernierValideLe: null } as unknown as Parameters<typeof composerEtatPublic>[0];
    const sans = composerEtatPublic(faits, { total: 0 }, { lus: 0, nonLus: 0 }, false, { faits: 0, papiers: 0 });
    expect("agenda" in sans).toBe(false);
    const avec = composerEtatPublic(faits, { total: 0 }, { lus: 0, nonLus: 0 }, false, { faits: 0, papiers: 0 }, { jour: JOUR, evenements: 3, luLe: "2026-10-26T11:58:00.000Z" });
    expect(avec.agenda).toEqual({ jour: JOUR, evenements: 3, luLe: "2026-10-26T11:58:00.000Z" });
    expect(composerEtatPublic(faits, { total: 0 }, { lus: 0, nonLus: 0 }, false, { faits: 0, papiers: 0 }, null).agenda).toBeNull();
  });
});
