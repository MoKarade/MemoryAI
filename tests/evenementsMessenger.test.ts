// tests/evenementsMessenger.test.ts — le lecteur d'export Messenger (ADR 0020), sur des exports FICTIFS.

import { describe, it, expect } from "vitest";
import { lireDate, lireExportMessenger } from "../lib/evenements/messenger";
import { exportFictif } from "./fixtures/messenger";

describe("lireDate", () => {
  it("lit l'heure de Marc et la rend en UTC, heure avancée comprise", () => {
    expect(lireDate("fév 11, 2021 7:00:52 am")).toBe("2021-02-11T12:00:52.000Z"); // UTC-5 en hiver
    expect(lireDate("juil 4, 2022 9:15:00 pm")).toBe("2022-07-05T01:15:00.000Z"); // UTC-4 en été
    expect(lireDate("oct 12, 2017 12:11:44 pm")).toBe("2017-10-12T16:11:44.000Z");
    expect(lireDate("déc 31, 2019 12:00:00 am")).toBe("2019-12-31T05:00:00.000Z");
    expect(lireDate("août 1, 2020 8:00 am")).toBe("2020-08-01T12:00:00.000Z");
  });

  it("une date qui ne se lit pas rend null, jamais une date approchée", () => {
    for (const s of ["", "hier", "zzz 11, 2021 7:00:52 am", "fév 31, 2021 7:00:52 am", "fév 11, 2021 13:00:52 pm", "fév 11 2021"]) {
      expect(lireDate(s)).toBeNull();
    }
  });
});

describe("lireExportMessenger", () => {
  const html = exportFictif({
    fil: "Club &amp; amis",
    participants: ["Alice Fictive", "Bruno Fictif", "Paul Exemple"],
    messages: [
      { auteur: "Bruno Fictif", date: "mars 2, 2021 10:00:00 am", texte: "Deux lignes<br /> <br /> la suite &#064;Alice", reactions: ["Alice Fictive"] },
      { auteur: "Alice Fictive", date: "mars 2, 2021 9:59:00 am", photo: true },
      { auteur: "Paul Exemple", date: "mars 1, 2021 8:00:00 pm", texte: "Premier message" },
    ],
  });
  const lu = lireExportMessenger(html);

  it("rend le fil, le titulaire et les participants", () => {
    expect(lu.fil).toBe("Club & amis");
    expect(lu.titulaire).toBe("Paul Exemple");
    expect(lu.participants).toEqual(["Alice Fictive", "Bruno Fictif", "Paul Exemple"]);
  });

  it("rend les messages du plus ancien au plus récent, position 0 d'abord", () => {
    expect(lu.messages).toEqual([
      { position: 0, auteur: "Paul Exemple", texte: "Premier message", survenuLe: "2021-03-02T01:00:00.000Z", piecesJointes: 0 },
      { position: 1, auteur: "Alice Fictive", texte: null, survenuLe: "2021-03-02T14:59:00.000Z", piecesJointes: 1 },
      { position: 2, auteur: "Bruno Fictif", texte: "Deux lignes\n\nla suite @Alice", survenuLe: "2021-03-02T15:00:00.000Z", piecesJointes: 0 },
    ]);
    expect(lu.datesIllisibles).toBe(0);
  });

  it("une date illisible écarte le message et se compte", () => {
    const r = lireExportMessenger(
      exportFictif({ messages: [{ auteur: "A", date: "bientôt", texte: "x" }, { auteur: "A", date: "jan 1, 2020 1:00:00 am", texte: "y" }] }),
    );
    expect(r.messages.map((m) => m.texte)).toEqual(["y"]);
    expect(r.datesIllisibles).toBe(1);
  });

  it("un fichier qui n'a pas la forme rend zéro message", () => {
    expect(lireExportMessenger("<html><body><p>rien</p></body></html>")).toEqual({
      fil: null,
      titulaire: null,
      participants: [],
      messages: [],
      datesIllisibles: 0,
    });
  });
});
