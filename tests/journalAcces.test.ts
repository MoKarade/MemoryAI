// tests/journalAcces.test.ts — éprouver l'écriture du journal d'accès chaîné.

import { describe, it, expect, vi } from "vitest";
import { journaliserAcces, type AccesAJournaliser } from "../lib/journalAcces";
import { signerEntree, VERSION_JOURNAL_ACTUELLE, type EntreeASigner } from "../lib/journal";
import type { DepotLecture, NouvelleEntreeJournal } from "../lib/depotLecture";
import type { EntreeJournal } from "../lib/db/schema";

const cleFictive = Buffer.alloc(32, 7);
const maintenantFixe = () => new Date("2026-10-28T12:00:00.000Z");

describe("journaliserAcces", () => {
  it("tête de chaîne vide (derniereEntreeJournal rend null)", async () => {
    const journaliserMock = vi.fn().mockResolvedValue(undefined);
    const depot: Partial<DepotLecture> = {
      derniereEntreeJournal: vi.fn().mockResolvedValue(null),
      journaliser: journaliserMock,
    };

    const acces: AccesAJournaliser = {
      lecteur: "chat",
      outil: "memoryai_contexte",
      usage: "conversation",
      niveauMaxServi: 1,
      idsFaits: ["f1", "f2"],
      questionEmpreinte: "empreinte123",
    };

    await journaliserAcces(depot as DepotLecture, cleFictive, acces, maintenantFixe);

    expect(journaliserMock).toHaveBeenCalledTimes(1);
    const appel = journaliserMock.mock.calls[0]![0] as NouvelleEntreeJournal;
    expect(appel.version).toBe(VERSION_JOURNAL_ACTUELLE);
    expect(appel.hmacPrecedent).toBeNull();
    expect(appel.idsPieces).toEqual([]);
    expect(appel.coutUsd).toBeNull();
    expect(appel.lecteur).toBe("chat");
    expect(appel.outil).toBe("memoryai_contexte");
    expect(appel.usage).toBe("conversation");
    expect(appel.niveauMaxServi).toBe(1);
    expect(appel.idsFaits).toEqual(["f1", "f2"]);
    expect(appel.questionEmpreinte).toBe("empreinte123");
  });

  it("chaînage avec une tête existante", async () => {
    const hmacTete = "a".repeat(64);
    const teteFictive = { hmac: hmacTete } as EntreeJournal;
    const journaliserMock = vi.fn().mockResolvedValue(undefined);
    const depot: Partial<DepotLecture> = {
      derniereEntreeJournal: vi.fn().mockResolvedValue(teteFictive),
      journaliser: journaliserMock,
    };

    const acces: AccesAJournaliser = {
      lecteur: "claude-ai",
      outil: "memoryai_chercher",
      usage: "action",
      niveauMaxServi: 2,
      idsFaits: ["f3"],
      idsPieces: ["p1"],
      questionEmpreinte: null,
      coutUsd: 0.002,
    };

    const dateFixe = maintenantFixe();
    await journaliserAcces(depot as DepotLecture, cleFictive, acces, () => dateFixe);

    expect(journaliserMock).toHaveBeenCalledTimes(1);
    const e = journaliserMock.mock.calls[0]![0] as NouvelleEntreeJournal;
    expect(e.hmacPrecedent).toBe(hmacTete);

    const aSigner: EntreeASigner = {
      version: VERSION_JOURNAL_ACTUELLE,
      ts: dateFixe.toISOString(),
      lecteur: acces.lecteur,
      outil: acces.outil,
      usage: acces.usage,
      niveauMaxServi: acces.niveauMaxServi,
      idsFaits: acces.idsFaits,
      idsPieces: acces.idsPieces,
      questionEmpreinte: acces.questionEmpreinte,
    };
    const attendu = signerEntree(cleFictive, hmacTete, aSigner);
    expect(e.hmac).toBe(attendu.hmac);
  });

  it("ts : date passée et corpus signé avec ts.toISOString()", async () => {
    const dateInjectee = new Date("2026-10-28T15:30:00.123Z");
    const journaliserMock = vi.fn().mockResolvedValue(undefined);
    const depot: Partial<DepotLecture> = {
      derniereEntreeJournal: vi.fn().mockResolvedValue(null),
      journaliser: journaliserMock,
    };

    const acces: AccesAJournaliser = {
      lecteur: "widget",
      outil: "memoryai_contexte",
      usage: "conversation",
      niveauMaxServi: 1,
      idsFaits: [],
      questionEmpreinte: "q1",
    };

    await journaliserAcces(depot as DepotLecture, cleFictive, acces, () => dateInjectee);

    expect(journaliserMock).toHaveBeenCalledTimes(1);
    const e = journaliserMock.mock.calls[0]![0] as NouvelleEntreeJournal;
    expect(e.ts).toEqual(dateInjectee);

    const aSigner: EntreeASigner = {
      version: VERSION_JOURNAL_ACTUELLE,
      ts: dateInjectee.toISOString(),
      lecteur: acces.lecteur,
      outil: acces.outil,
      usage: acces.usage,
      niveauMaxServi: acces.niveauMaxServi,
      idsFaits: acces.idsFaits,
      idsPieces: [],
      questionEmpreinte: acces.questionEmpreinte,
    };
    const signature = signerEntree(cleFictive, null, aSigner);
    expect(e.hmac).toBe(signature.hmac);
  });

  it("concurrence : la première insertion échoue, la seconde réussit", async () => {
    const derniereEntreeJournalMock = vi
      .fn()
      .mockResolvedValueOnce({ hmac: "11".repeat(32) } as EntreeJournal)
      .mockResolvedValueOnce({ hmac: "22".repeat(32) } as EntreeJournal);

    const journaliserMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("concurrence hmac_precedent"))
      .mockResolvedValueOnce(undefined);

    const depot: Partial<DepotLecture> = {
      derniereEntreeJournal: derniereEntreeJournalMock,
      journaliser: journaliserMock,
    };

    const acces: AccesAJournaliser = {
      lecteur: "chat",
      outil: "memoryai_contexte",
      usage: "conversation",
      niveauMaxServi: 1,
      idsFaits: ["f1"],
      questionEmpreinte: null,
    };

    await expect(
      journaliserAcces(depot as DepotLecture, cleFictive, acces, maintenantFixe),
    ).resolves.toBeUndefined();

    expect(derniereEntreeJournalMock).toHaveBeenCalledTimes(2);
    expect(journaliserMock).toHaveBeenCalledTimes(2);
  });

  it("échec double : rejette avec la DERNIÈRE erreur ou message formaté si non-Error", async () => {
    const err1 = new Error("premier échec");
    const err2 = new Error("second échec");

    const depotError: Partial<DepotLecture> = {
      derniereEntreeJournal: vi.fn().mockResolvedValue(null),
      journaliser: vi.fn().mockRejectedValueOnce(err1).mockRejectedValueOnce(err2),
    };

    const acces: AccesAJournaliser = {
      lecteur: "chat",
      outil: "memoryai_contexte",
      usage: "conversation",
      niveauMaxServi: 1,
      idsFaits: [],
      questionEmpreinte: null,
    };

    await expect(
      journaliserAcces(depotError as DepotLecture, cleFictive, acces, maintenantFixe),
    ).rejects.toBe(err2);

    const depotNonError: Partial<DepotLecture> = {
      derniereEntreeJournal: vi.fn().mockResolvedValue(null),
      journaliser: vi.fn().mockRejectedValue("string error"),
    };

    await expect(
      journaliserAcces(depotNonError as DepotLecture, cleFictive, acces, maintenantFixe),
    ).rejects.toThrow("journal d'accès : écriture impossible");
  });

  it("si derniereEntreeJournal rejette, l'erreur remonte", async () => {
    const errLecture = new Error("erreur de lecture base");
    const journaliserMock = vi.fn();
    const depot: Partial<DepotLecture> = {
      derniereEntreeJournal: vi.fn().mockRejectedValue(errLecture),
      journaliser: journaliserMock,
    };

    const acces: AccesAJournaliser = {
      lecteur: "chat",
      outil: "memoryai_contexte",
      usage: "conversation",
      niveauMaxServi: 1,
      idsFaits: [],
      questionEmpreinte: null,
    };

    await expect(
      journaliserAcces(depot as DepotLecture, cleFictive, acces, maintenantFixe),
    ).rejects.toBe(errLecture);

    expect(journaliserMock).not.toHaveBeenCalled();
  });
});
