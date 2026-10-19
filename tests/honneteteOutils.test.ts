// tests/honneteteOutils.test.ts — un outil qui tronque DIT combien il cache, et une date
// impossible n'entre pas.
//
// ⚠️ Les deux défauts gardés ici viennent de captures d'écran de Marc, le 17/09. Ils ont en
// commun d'être INVISIBLES depuis le code : ni l'un ni l'autre ne fait échouer quoi que ce
// soit, ils font seulement dire des choses fausses.
//
//   1. Marc demande à claude.ai combien il a de papiers : « au moins 214 ». Puis combien
//      viennent de Banque Aurore : « au moins 68 ». Les vrais chiffres sont 2 723 et 75. Le
//      modèle n'avait pas menti — `memoryai_papiers_chercher` tronquait sans jamais dire
//      combien de pièces correspondaient. Devant une liste pleine, un lecteur ne peut
//      qu'inventer une borne basse, et il la présente comme un fait.
//   2. Une pièce du domaine `01`, datée du 2026-03-24, porte une échéance au **2125-03-23**.
//      Un siècle. Le schéma bornait `annee` à [1900, 2100] mais pas les DATES, qui n'avaient
//      qu'un contrôle de FORME. Une échéance à un siècle ne fait rien planter : elle se range
//      en dernier pour toujours, et le papier n'expire jamais aux yeux de la mémoire — ce qui
//      vide la question n° 6 du socle (« qu'est-ce qui expire dans les 90 prochains jours »).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotPiecesDrizzle } from "../lib/pieces/depot";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";
import { ecrireLotPieces } from "../lib/pieces/ecrire";
import { validerPiece } from "../lib/pieces/validerPiece";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(Buffer.alloc(32, 21).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-tiers"] };

const PIECE = {
  exemplaires: [{ file_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz01" }],
  domaine: "02 · Finances",
  type: "Relevé",
  emetteur: "Banque Aurore",
  annee: 2026,
  date_document: "2026-03-24",
  extracteur: "haiku-4.5-piece-v1",
};

describe("une date impossible n'entre pas", () => {
  it("MUTATION — retirer la borne des dates fait rougir ce cas", () => {
    // Le cas RÉEL, au caractère près.
    const r = validerPiece({ ...PIECE, date_echeance: "2125-03-23" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("date-invalide");
      expect(r.champ).toBe("date_echeance");
      // Le message NOMME la valeur fautive : un refus qui ne dit pas quoi corriger se
      // re-tente à l'identique.
      expect(r.message).toContain("2125-03-23");
    }
  });

  it("la date du DOCUMENT est bornée aussi, pas seulement l'échéance", () => {
    const r = validerPiece({ ...PIECE, date_document: "0203-01-01" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.champ).toBe("date_document");
  });

  it("les bornes sont LARGES — le contrôle négatif", () => {
    // ⚠️ Ce qu'on refuse n'est pas « improbable » mais IMPOSSIBLE. Un acte de naissance de
    // 1920 et un bail qui court jusqu'en 2090 sont des papiers légitimes ; les refuser
    // ferait perdre de vrais documents, ce qui est bien pire qu'une échéance farfelue.
    expect(validerPiece({ ...PIECE, date_document: "1920-05-01" }).ok).toBe(true);
    expect(validerPiece({ ...PIECE, date_echeance: "2090-12-31" }).ok).toBe(true);
    expect(validerPiece({ ...PIECE }).ok).toBe(true);
  });

  it("l'échéance qui précède le document reste refusée — la garde d'avant n'a pas bougé", () => {
    const r = validerPiece({ ...PIECE, date_document: "2026-03-24", date_echeance: "2025-01-01" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("date-invalide");
  });
});

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

describe("compter ce qui correspond, sur une vraie Postgres", () => {
  beforeEach(async () => {
    pg = new PGlite();
    for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
      for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
        if (s.trim()) await pg.exec(s);
      }
    }
    db = drizzle(pg, { schema });
    // Sept relevés de 2026 et trois de 2025 : assez pour que compter et tronquer diffèrent.
    const entrees = [
      ...Array.from({ length: 7 }, (_, i) => ({
        ...PIECE,
        exemplaires: [{ file_id: `1AbCdEfGhIjKlMnOpQrStUvWxYzD${i}` }],
        date_document: `2026-0${i + 1}-01`,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        ...PIECE,
        exemplaires: [{ file_id: `1AbCdEfGhIjKlMnOpQrStUvWxYzH${i}` }],
        emetteur: "Hydro",
        annee: 2025,
        date_document: `2025-0${i + 1}-01`,
      })),
    ];
    const r = await ecrireLotPieces(entrees, DRIVEAI, cle, depotPiecesDrizzle(db));
    // ⚠️ Anti-vacuité : une fixture qui n'écrit rien rendrait tous les comptes égaux à zéro,
    // et les trois cas ci-dessous passeraient sans mesurer quoi que ce soit.
    expect(r.acceptees).toBe(10);
  });

  afterEach(async () => {
    await pg?.close();
  });

  it("MUTATION — faire rendre `lignes.length` à compter() fait rougir ce cas", async () => {
    const lecture = depotPiecesLectureDrizzle(db);
    // La tranche demandée est plus PETITE que ce qui correspond : c'est exactement la
    // situation où le lecteur inventait une borne basse.
    const tronque = await lecture.chercher({ limite: 4 });
    expect(tronque).toHaveLength(4);
    // Le compte, lui, ignore la tranche ET la borne de lecture.
    expect(await lecture.compter({})).toBe(10);
  });

  it("le compte suit les MÊMES filtres que la liste", async () => {
    const lecture = depotPiecesLectureDrizzle(db);
    const annees = [2026];
    // ⚠️ C'est la propriété qui compte vraiment : un total qui ne décrit pas la liste
    // affichée est pire qu'un total absent. Les conditions sont donc écrites une seule fois
    // et partagées — ce cas rougit si quelqu'un en recopie une version.
    const liste = await lecture.chercher({ annees, limite: 100 });
    expect(await lecture.compter({ annees })).toBe(liste.length);
    expect(liste.length).toBe(7);
  });

  it("aucune correspondance ⇒ zéro, jamais une erreur — le contrôle négatif", async () => {
    const lecture = depotPiecesLectureDrizzle(db);
    expect(await lecture.compter({ annees: [1999] })).toBe(0);
    expect(await lecture.chercher({ annees: [1999], limite: 10 })).toEqual([]);
  });
});
