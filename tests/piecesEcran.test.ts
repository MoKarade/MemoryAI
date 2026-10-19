// tests/piecesEcran.test.ts — CE QUE L'ÉCRAN DES PAPIERS PEUT DIRE, et ce qu'il ne doit pas.
//
// Écrit le 21/09/2026, après que Marc a lu l'écran des papiers : « pour l'instant ça sert à
// rien je comprends rien ». La page montrait six colonnes de métadonnées techniques et aucune
// ne disait ce que le papier ÉTAIT — alors que le type et l'émetteur étaient en base depuis le
// premier jour, et que la couche de lecture les jetait.
//
// Quatre propriétés, et aucune ne se déduit du code :
//
//  1. le filtre « lus / pas encore lus » sépare vraiment les deux populations, et le COMPTE
//     s'accorde avec la LISTE — deux réponses à la même question qui divergeraient feraient
//     annoncer un total qui ne décrit pas ce qui est montré ;
//  2. `parId` refuse ce qui n'est plus vivant : un papier retiré ne se rouvre pas par son
//     adresse ;
//  3. `rendreFacettesPiece` ne rend JAMAIS le contenu — c'est la garde de l'écran de liste,
//     et elle se prouve sur les clés rendues, pas sur la bonne intention du type ;
//  4. un extracteur inconnu se CITE au lieu d'être rangé dans « lu » ou « pas lu » : les deux
//     affirmations seraient inventées, et l'une des deux est exactement ce que Marc vérifie.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotPiecesDrizzle } from "../lib/pieces/depot";
import { ecrireLotPieces } from "../lib/pieces/ecrire";
import { depotOubliPiecesDrizzle } from "../lib/pieces/depotOubli";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";
import { rendreFacettesPiece, rendreLisiblePiece } from "../lib/pieces/lecture";
import { EXTRACTEUR_MIGRATION } from "../lib/pieces/migration";
import { libelleExtracteur, titrePiece } from "../lib/pieces/presentation";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(Buffer.alloc(32, 7).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };
const TOUT = { inclureN2: true, n2Autorise: true, inclureN3: true, n3Autorise: true, inclureProposes: true };

let pg: PGlite;
let db: ReturnType<typeof drizzle>;

const papier = (fileId: string, extra: Record<string, unknown> = {}) => ({
  type: "relevé",
  emetteur: "Banque Aurore",
  annee: 2025,
  domaine: "02 · Finances",
  date_document: "2025-03-01",
  resume: "Un relevé de compte de mars 2025.",
  champs_structures: { montants: [{ libelle: "solde", valeur: "1 234,00 $" }] },
  exemplaires: [{ file_id: fileId, chemin: `/02 · Finances/${fileId}` }],
  extracteur: "haiku-4.5-piece-v2",
  ...extra,
});

const idDe = async (fileId: string) => {
  const r = await db
    .select({ id: schema.pieceExemplaires.pieceId })
    .from(schema.pieceExemplaires)
    .where(eq(schema.pieceExemplaires.fileId, fileId));
  return r[0]!.id;
};

beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.query(s);
    }
  }
  db = drizzle(pg, { schema });
  await ecrireLotPieces(
    [
      papier("ecr-lu-1"),
      papier("ecr-lu-2", { date_document: "2025-04-01" }),
      papier("ecr-inv-1", { extracteur: EXTRACTEUR_MIGRATION, resume: null, champs_structures: null }),
    ],
    DRIVEAI,
    cle,
    depotPiecesDrizzle(db),
  );
});

afterAll(async () => {
  await pg?.close();
});

describe("le filtre « lus / pas encore lus »", () => {
  it("sépare les deux populations, et le compte s'accorde avec la liste", async () => {
    const d = depotPiecesLectureDrizzle(db);

    const lus = await d.chercher({ lus: true, limite: 50 });
    const attente = await d.chercher({ lus: false, limite: 50 });
    const tous = await d.chercher({ limite: 50 });

    expect(lus.map((x) => x.piece.extracteur)).toEqual(["haiku-4.5-piece-v2", "haiku-4.5-piece-v2"]);
    expect(attente.map((x) => x.piece.extracteur)).toEqual([EXTRACTEUR_MIGRATION]);
    expect(tous.length).toBe(3);

    // ⚠️ Le COMPTE et la LISTE répondent à la même question par deux chemins : `conditionsDe`
    // est partagé exprès. Les faire diverger afficherait « 12 papiers » au-dessus de 3 lignes.
    expect(await d.compter({ lus: true })).toBe(lus.length);
    expect(await d.compter({ lus: false })).toBe(attente.length);
    expect(await d.compter({})).toBe(tous.length);
  });
});

describe("parId", () => {
  it("rend la pièce ET ses exemplaires", async () => {
    const id = await idDe("ecr-lu-1");
    const r = await depotPiecesLectureDrizzle(db).parId(id);
    expect(r?.piece.id).toBe(id);
    expect(r?.exemplaires.map((x) => x.fileId)).toEqual(["ecr-lu-1"]);
  });

  it("refuse un papier retiré — il ne se rouvre pas par son adresse", async () => {
    const id = await idDe("ecr-lu-2");
    expect(await depotOubliPiecesDrizzle(db).oublier(id, cle, "test", new Date())).toBe("ok");
    expect(await depotPiecesLectureDrizzle(db).parId(id)).toBeNull();
  });

  it("rend null sur un identifiant qui n'existe pas", async () => {
    expect(await depotPiecesLectureDrizzle(db).parId("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("la liste ne déchiffre que les facettes", () => {
  it("rend le type et l'émetteur, et AUCUN contenu", async () => {
    const id = await idDe("ecr-lu-1");
    const brute = (await depotPiecesLectureDrizzle(db).parId(id))!;

    const f = rendreFacettesPiece(brute, TOUT, cle)!;
    expect(f.type).toBe("relevé");
    expect(f.emetteur).toBe("Banque Aurore");
    expect(f.lien).toContain("ecr-lu-1");

    // ⚠️ La propriété qui compte : cent papiers affichés ne déposent pas cent résumés en clair
    // dans le HTML. Elle se prouve sur les CLÉS rendues — ajouter `resume` au retour ferait
    // tomber ce test, et c'est exactement ce qu'on veut empêcher.
    const cles = Object.keys(f);
    for (const interdit of ["resume", "champsStructures", "champsLibres", "chemin"]) {
      expect(cles).not.toContain(interdit);
    }

    // Contrôle inverse : le contenu EXISTE, et c'est l'écran de détail qui l'ouvre. Sans ce
    // cas, « aucun résumé rendu » serait vrai parce que la fixture n'en a pas.
    const complet = rendreLisiblePiece(brute, TOUT, cle)!;
    expect(complet.resume).toContain("mars 2025");
    expect(complet.champsStructures).toEqual({ montants: [{ libelle: "solde", valeur: "1 234,00 $" }] });
  });
});

describe("comment un papier se présente", () => {
  it("un papier d'inventaire se dit NON LU, et dit pourquoi", () => {
    const l = libelleExtracteur(EXTRACTEUR_MIGRATION);
    expect(l.lu).toBe(false);
    expect(l.court).toMatch(/pas encore lu/i);
    expect(l.phrase).toMatch(/nom de fichier/i);
  });

  it("un modèle connu se nomme", () => {
    const l = libelleExtracteur("haiku-4.5-piece-v2");
    expect(l.lu).toBe(true);
    expect(l.court).toContain("Haiku 4.5");
  });

  it("un extracteur INCONNU se cite, au lieu d'être rangé quelque part", () => {
    const l = libelleExtracteur("sonnet-9-piece-v1");
    expect(l.lu).toBe(true);
    expect(l.court).toContain("sonnet-9-piece-v1");
    expect(l.phrase).toContain("sonnet-9-piece-v1");
  });

  it("un titre absent rend null — l'écran décide quoi en dire", () => {
    expect(titrePiece({ type: "Relevé", emetteur: "Banque Aurore" })).toBe("Relevé — Banque Aurore");
    expect(titrePiece({ type: "Relevé", emetteur: null })).toBe("Relevé");
    expect(titrePiece({ type: null, emetteur: "Banque Aurore" })).toBe("Banque Aurore");
    expect(titrePiece({ type: null, emetteur: null })).toBeNull();
    expect(titrePiece({ type: "  ", emetteur: "  " })).toBeNull();
  });
});
