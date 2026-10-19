// tests/pageDonnees.test.ts — validation des sorties d'accesDonnees et MESSAGES_MANQUE

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  baseConfiguree: vi.fn(),
  cleDepuisEnv: vi.fn(),
  assurerMigrations: vi.fn(),
  db: { __fictif: "db" },
  cleFictive: { chiffrement: Buffer.from("cle-fictive"), empreinte: Buffer.from("empreinte-fictive") },
}));

vi.mock("../lib/db", () => ({
  baseConfiguree: mocks.baseConfiguree,
  db: mocks.db,
}));

vi.mock("../lib/migrations", () => ({
  assurerMigrations: mocks.assurerMigrations,
}));

vi.mock("../lib/chiffrement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/chiffrement")>();
  return {
    ...actual,
    cleDepuisEnv: mocks.cleDepuisEnv,
  };
});

import { accesDonnees, MESSAGES_MANQUE } from "../lib/pageDonnees";
import { ClefAbsenteError } from "../lib/chiffrement";

describe("pageDonnees — accesDonnees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retourne { ok: false, manque: 'base' } sans appeler cleDepuisEnv ni assurerMigrations si la base n'est pas configurée", async () => {
    mocks.baseConfiguree.mockReturnValue(false);

    const reponse = await accesDonnees();

    expect(reponse).toEqual({ ok: false, manque: "base" });
    expect(mocks.cleDepuisEnv).not.toHaveBeenCalled();
    expect(mocks.assurerMigrations).not.toHaveBeenCalled();
  });

  it("retourne { ok: false, manque: 'cle' } sans appeler assurerMigrations si la base est présente mais cleDepuisEnv lève ClefAbsenteError", async () => {
    mocks.baseConfiguree.mockReturnValue(true);
    mocks.cleDepuisEnv.mockImplementation(() => {
      throw new ClefAbsenteError();
    });

    const reponse = await accesDonnees();

    expect(reponse).toEqual({ ok: false, manque: "cle" });
    expect(mocks.assurerMigrations).not.toHaveBeenCalled();
  });

  it("rejette avec l'erreur originale si la base est présente mais cleDepuisEnv lève une AUTRE erreur", async () => {
    mocks.baseConfiguree.mockReturnValue(true);
    const erreurInattendue = new Error("Erreur inattendue de clef");
    mocks.cleDepuisEnv.mockImplementation(() => {
      throw erreurInattendue;
    });

    await expect(accesDonnees()).rejects.toThrow(erreurInattendue);
  });

  it("retourne { ok: true, cle, db } avec la clé et la base des doublures, et appelle assurerMigrations une seule fois si tout est présent", async () => {
    mocks.baseConfiguree.mockReturnValue(true);
    mocks.cleDepuisEnv.mockReturnValue(mocks.cleFictive);
    mocks.assurerMigrations.mockResolvedValue(undefined);

    const reponse = await accesDonnees();

    expect(reponse).toEqual({
      ok: true,
      cle: mocks.cleFictive,
      db: mocks.db,
    });
    expect(mocks.assurerMigrations).toHaveBeenCalledTimes(1);
  });

  it("vérifie que MESSAGES_MANQUE.base contient DATABASE_URL et MESSAGES_MANQUE.cle contient MEMORYAI_CHIFFREMENT", () => {
    expect(MESSAGES_MANQUE.base).toContain("DATABASE_URL");
    expect(MESSAGES_MANQUE.cle).toContain("MEMORYAI_CHIFFREMENT");
  });
});
