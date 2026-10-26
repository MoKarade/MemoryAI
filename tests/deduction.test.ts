// tests/deduction.test.ts — les règles de l'ADR 0023, pures. Données FICTIVES : noms et dates
// inventés. Ce qui est vérifié : que l'âge change LE jour anniversaire (ni avant, ni après), que
// seuls les papiers de Marc comptent, et qu'une contradiction donne une abstention, pas un choix.

import { describe, expect, it } from "vitest";
import { age, cleNom, dateNaissanceDe, naissanceDeMarc, periodeAge, prochainAnniversaire, type PapierPourDeduction } from "../lib/deduction";

const papier = (id: string, titulaire: string | null, naissance: string | null, fileId: string | null = `f-${id}`): PapierPourDeduction => ({
  id,
  fileId,
  titulaire,
  champsLibres: naissance === null ? { "numéro": "X0000000" } : { "date de naissance": naissance },
});

describe("l'âge", () => {
  it("change le jour anniversaire, pas la veille", () => {
    expect(age("1990-03-14", "2026-03-13")).toBe(35);
    expect(age("1990-03-14", "2026-03-14")).toBe(36);
    expect(age("1990-03-14", "2026-12-31")).toBe(36);
  });

  it("un 29 février compte le 1er mars les années non bissextiles", () => {
    expect(age("2000-02-29", "2027-02-28")).toBe(26);
    expect(age("2000-02-29", "2027-03-01")).toBe(27);
    expect(prochainAnniversaire("2000-02-29", "2027-01-10")).toBe("2027-03-01");
    expect(prochainAnniversaire("2000-02-29", "2028-01-10")).toBe("2028-02-29");
  });

  it("le prochain anniversaire exclut le jour même", () => {
    expect(prochainAnniversaire("1990-03-14", "2026-03-14")).toBe("2027-03-14");
    expect(prochainAnniversaire("1990-03-14", "2026-03-13")).toBe("2026-03-14");
  });

  it("la période d'un âge va du dernier anniversaire à la veille du prochain", () => {
    expect(periodeAge("1990-03-14", "2026-10-26")).toEqual({ de: "2026-03-14", a: "2027-03-13" });
    expect(periodeAge("1990-03-14", "2026-03-13")).toEqual({ de: "2025-03-14", a: "2026-03-13" });
    expect(periodeAge("1990-03-14", "2026-03-14")).toEqual({ de: "2026-03-14", a: "2027-03-13" });
    expect(periodeAge("2000-02-29", "2027-01-10")).toEqual({ de: "2026-03-01", a: "2027-02-28" });
  });
});

describe("le nom d'un titulaire", () => {
  it("même nom à l'ordre des mots, à la casse, aux accents et à la ponctuation près", () => {
    expect(cleNom("FICTIF, Nôm")).toBe(cleNom("nom fictif"));
    expect(cleNom("Nom Fictif")).not.toBe(cleNom("Nom Fictive"));
  });
});

describe("la date de naissance d'un papier", () => {
  it("lit la clé de DriveAI, casse et accents ignorés, au format AAAA-MM-JJ seulement", () => {
    expect(dateNaissanceDe({ "Date de naissance": "1990-03-14" }, "2026-10-26")).toBe("1990-03-14");
    expect(dateNaissanceDe({ "date de naissance": "14/03/1990" }, "2026-10-26")).toBeNull();
    expect(dateNaissanceDe({ "date de délivrance": "1990-03-14" }, "2026-10-26")).toBeNull();
  });

  it("refuse une date impossible, d'avant 1900 ou dans le futur", () => {
    expect(dateNaissanceDe({ "date de naissance": "1990-02-30" }, "2026-10-26")).toBeNull();
    expect(dateNaissanceDe({ "date de naissance": "1899-12-31" }, "2026-10-26")).toBeNull();
    expect(dateNaissanceDe({ "date de naissance": "2026-10-27" }, "2026-10-26")).toBeNull();
    expect(dateNaissanceDe(null, "2026-10-26")).toBeNull();
  });
});

describe("la date de naissance de Marc, d'après SES papiers", () => {
  const JOUR = "2026-10-26";

  it("deux papiers de Marc qui s'accordent : une date, et ses deux sources triées", () => {
    const r = naissanceDeMarc([papier("b", "Nom Fictif", "1990-03-14"), papier("a", "nom  fictif", "1990-03-14")], ["Nom Fictif"], JOUR);
    expect(r).toEqual({ ok: true, date: "1990-03-14", papiers: [{ id: "a", fileId: "f-a" }, { id: "b", fileId: "f-b" }] });
  });

  it("le papier d'un proche, ou sans titulaire, ou sans exemplaire, ne compte pas", () => {
    const r = naissanceDeMarc(
      [papier("a", "Nom Fictif", "1990-03-14"), papier("b", "Proche Fictif", "1960-01-01"), papier("c", null, "1961-01-01"), papier("d", "Nom Fictif", "1962-01-01", null)],
      ["Nom Fictif"],
      JOUR,
    );
    expect(r).toEqual({ ok: true, date: "1990-03-14", papiers: [{ id: "a", fileId: "f-a" }] });
  });

  it("deux papiers de Marc qui se contredisent : abstention, jamais un choix", () => {
    expect(naissanceDeMarc([papier("a", "Nom Fictif", "1990-03-14"), papier("b", "Nom Fictif", "1990-03-15")], ["Nom Fictif"], JOUR)).toEqual({
      ok: false,
      motif: "contradiction",
      dates: 2,
    });
  });

  it("aucun nom de Marc connu, ou aucune date : rien, et le motif le dit", () => {
    expect(naissanceDeMarc([papier("a", "Nom Fictif", "1990-03-14")], [], JOUR)).toEqual({ ok: false, motif: "aucun-papier", dates: 0 });
    expect(naissanceDeMarc([papier("a", "Nom Fictif", null)], ["Nom Fictif"], JOUR)).toEqual({ ok: false, motif: "aucun-papier", dates: 0 });
  });
});
