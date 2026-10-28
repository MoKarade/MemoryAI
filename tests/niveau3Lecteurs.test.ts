// tests/niveau3Lecteurs.test.ts — ADR 0011 : le niveau 3 ouvert à Marc, et à lui seul.
//
// Sur une VRAIE Postgres (PGlite), par le vrai chemin des outils. Ce qui est prouvé :
//
//  1. le MCP (`claude-ai`) ne reçoit JAMAIS le contenu d'un papier N3, même avec
//     `MEMORYAI_N3_CHAT=1` ET `inclure_n3: true` — les deux verrous de l'ADR 0007, qui ne
//     suffisaient plus parce que le second était à la main du modèle appelant ;
//  2. un lecteur INCONNU est fermé aussi (liste blanche, pas exclusion) ;
//  3. le chat, lui, le reçoit ;
//  4. les FACETTES ne rendent pas au MCP les titulaires que le sommaire cache ;
//  5. le titulaire devient un filtre, et il ne confirme rien au MCP ;
//  6. le plein texte atteint les papiers N3 — en mémoire, pour le chat seulement.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotPiecesDrizzle } from "../lib/pieces/depot";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";
import { ecrireLotPieces } from "../lib/pieces/ecrire";
import { NOTE_N3_HORS_CHAT, outilParNom, type ContexteOutils } from "../lib/mcp/outils";
import { traiterMessage } from "../lib/mcp/protocole";
import { LECTEURS_N3, lecteurPeutN3 } from "../lib/lecture";
import { motsDeLaQuestion, pieceCorrespond } from "../lib/pieces/rechercheEnMemoire";
import type { PieceLisible } from "../lib/pieces/lecture";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(Buffer.alloc(32, 9).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };
const OUVERT = { MEMORYAI_N3_CHAT: "1" };
// Un numéro FABRIQUÉ, reconnaissable, qu'aucun sommaire ne doit laisser passer.
const NUMERO = ["XK", "77", "31", "904"].join("");

let pg: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
  const r = await ecrireLotPieces(
    [
      {
        type: "passeport",
        emetteur: "République Exemple",
        titulaire: "Jean Exemple",
        titulaire_confiance: 0.95,
        annee: 2019,
        domaine: "04 · Immigration",
        date_document: "2020-03-18",
        date_echeance: "2030-03-17",
        resume: "Passeport de Jean Exemple.",
        champs_structures: { numeros: [{ libelle: "numéro de passeport", valeur: NUMERO }] },
        exemplaires: [{ file_id: "fid-passeport", chemin: "/04 · Immigration/Passeport" }],
        extracteur: "haiku-4.5-piece-v1",
      },
      {
        type: "bail",
        emetteur: "Gestion Exemple",
        annee: 2026,
        domaine: "05 · Carrière",
        date_document: "2026-03-01",
        resume: "Bail de 12 mois.",
        exemplaires: [{ file_id: "fid-bail", chemin: "/05 · Carrière/Bail" }],
        extracteur: "haiku-4.5-piece-v1",
      },
    ],
    DRIVEAI,
    cle,
    depotPiecesDrizzle(db),
  );
  expect(r.acceptees).toBe(2);
});

afterAll(async () => {
  await pg.close();
});

const ctx = (lecteur: string, env: Record<string, string | undefined>) =>
  ({
    pieces: depotPiecesLectureDrizzle(db),
    cle,
    env,
    lecteur,
    maintenant: () => new Date("2026-09-24T12:00:00Z"),
  }) as unknown as ContexteOutils;

const appeler = (nom: string, args: Record<string, unknown>, lecteur: string, env: Record<string, string | undefined> = OUVERT) =>
  outilParNom(nom)!.executer(args, ctx(lecteur, env));

describe("ADR 0011 — la liste des lecteurs qui peuvent lire N3", () => {
  it("ne contient QUE le chat", () => {
    expect([...LECTEURS_N3]).toEqual(["chat"]);
    expect(lecteurPeutN3("chat")).toBe(true);
    for (const l of ["claude-ai", "widget", "", "CHAT"]) expect(lecteurPeutN3(l), l).toBe(false);
  });
});

describe("ADR 0011 — le MCP ne lit plus le contenu des papiers d'identité", () => {
  it("claude-ai, MEMORYAI_N3_CHAT=1 ET inclure_n3 : sommaire, sans numéro, et le DIT", async () => {
    const r = await appeler("memoryai_papiers_chercher", { domaines: ["04 · Immigration"], inclure_n3: true }, "claude-ai");
    expect(r.texte).toContain('forme="sommaire"');
    expect(r.texte).not.toContain(NUMERO);
    expect(r.texte).not.toContain("République Exemple");
    expect(r.texte).toContain(NOTE_N3_HORS_CHAT);
    expect(r.texte).toContain("il ne se lit que dans le chat de MemoryAI");
    // Le journal note ce qui est RÉELLEMENT sorti : un sommaire N3 n'est pas « niveau 3 servi ».
    expect(r.niveauMaxServi).toBeLessThan(3);
    expect(r.niveauMaxServi).toBeGreaterThan(0);
  });

  it("un lecteur INCONNU est fermé aussi — c'est une liste blanche", async () => {
    const r = await appeler("memoryai_papiers_chercher", { domaines: ["04 · Immigration"], inclure_n3: true }, "widget");
    expect(r.texte).not.toContain(NUMERO);
    expect(r.texte).toContain('forme="sommaire"');
  });

  it("le chat, lui, reçoit le papier COMPLET", async () => {
    const r = await appeler("memoryai_papiers_chercher", { domaines: ["04 · Immigration"], inclure_n3: true }, "chat");
    expect(r.texte).toContain(NUMERO);
    expect(r.texte).toContain('forme="complete"');
    expect(r.niveauMaxServi).toBe(3);
  });

  it("tools/list ne propose plus inclure_n3 au MCP, et le propose au chat", async () => {
    const liste = async (lecteur: string) => {
      const rep = await traiterMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ctx(lecteur, OUVERT));
      return (rep as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] } }).result.tools;
    };
    const mcp = await liste("claude-ai");
    expect(mcp.length).toBeGreaterThan(0);
    for (const t of mcp) expect(Object.keys(t.inputSchema.properties), t.name).not.toContain("inclure_n3");
    // Anti-vacuité : l'outil qui DÉCLARE inclure_n3 existe, et le chat le voit.
    const chat = await liste("chat");
    expect(chat.find((t) => t.name === "memoryai_papiers_chercher")!.inputSchema.properties).toHaveProperty("inclure_n3");
  });

  it("les FACETTES ne rendent pas au MCP le titulaire d'un papier N3", async () => {
    const mcp = await appeler("memoryai_papiers_facettes", { famille: "titulaire" }, "claude-ai");
    expect(mcp.texte).not.toContain("Jean Exemple");
    const chat = await appeler("memoryai_papiers_facettes", { famille: "titulaire", inclure_n3: true }, "chat");
    expect(chat.texte).toContain("Jean Exemple — 1 papier(s)");
    // Revue #71 : le journal note le niveau RÉELLEMENT servi, pas 0.
    expect(chat.niveauMaxServi).toBe(3);
    // Le type d'un papier N3 non plus : le sommaire le cache, la facette ne le rend pas.
    expect((await appeler("memoryai_papiers_facettes", { famille: "type" }, "claude-ai")).texte).not.toContain("passeport");
  });
});

describe("ADR 0011 — revue #71 : ce que les facettes et les filtres laissaient deviner", () => {
  it("au MCP, filtrer par TYPE ou par ÉMETTEUR ne confirme pas un papier d'identité (oracle prouvé par sonde)", async () => {
    for (const args of [{ types: ["passeport"] }, { emetteurs: ["République Exemple"] }]) {
      const r = await appeler("memoryai_papiers_chercher", args, "claude-ai");
      expect(r.texte, JSON.stringify(args)).toContain("(aucune pièce)");
      expect(r.texte, JSON.stringify(args)).not.toContain("04 · Immigration");
    }
    // Anti-vacuité : le même filtre, pour le chat qui lit N3, trouve bien le papier.
    const chat = await appeler("memoryai_papiers_chercher", { types: ["passeport"], inclure_n3: true }, "chat");
    expect(chat.texte).toContain(NUMERO);
  });

  it("les facettes du CHAT suivent l'interrupteur ET la case — pas seulement le lecteur", async () => {
    // Interrupteur coupé : le chat ne voit pas le titulaire N3.
    const sansInterrupteur = await appeler("memoryai_papiers_facettes", { famille: "titulaire", inclure_n3: true }, "chat", {});
    expect(sansInterrupteur.texte).not.toContain("Jean Exemple");
    // Case décochée : ni le titulaire, ni le type.
    const decoche = await appeler("memoryai_papiers_facettes", { famille: "type", inclure_n3: false }, "chat");
    expect(decoche.texte).not.toContain("passeport");
    // Et l'autre papier, lui, reste listé : le filtre ne vide pas tout.
    expect(decoche.texte).toContain("bail");
  });

  it("/api/chat n'accepte qu'une conversation du CHAT comme suite", () => {
    const route = readFileSync(resolve(process.cwd(), "app/api/chat/route.ts"), "utf8");
    expect(route).toMatch(/existante\.source === "memoryai"/);
  });
});

describe("ADR 0011 — le titulaire est un filtre", () => {
  it("le chat retrouve le passeport par son titulaire", async () => {
    const r = await appeler("memoryai_papiers_chercher", { titulaires: ["Jean Exemple"], inclure_n3: true }, "chat");
    expect(r.texte).toContain(NUMERO);
    expect(r.texte).not.toContain("Gestion Exemple");
  });

  it("au MCP, filtrer par titulaire ne CONFIRME même pas qu'un papier d'identité existe", async () => {
    const r = await appeler("memoryai_papiers_chercher", { titulaires: ["Jean Exemple"] }, "claude-ai");
    expect(r.texte).toContain("(aucune pièce)");
    expect(r.texte).not.toContain("04 · Immigration");
  });
});

describe("ADR 0011 — le plein texte atteint les papiers N3, en mémoire", () => {
  it("« mon passeport » trouve le passeport dans le chat", async () => {
    const r = await appeler("memoryai_papiers_chercher", { question: "mon passeport", inclure_n3: true }, "chat");
    expect(r.texte).toContain(NUMERO);
    // Anti-vacuité : SANS la recherche en mémoire, le plein texte Postgres ne voit rien (le
    // papier N3 n'a pas de colonne `recherche`). Même question, même lecteur, N3 fermé.
    const ferme = await appeler("memoryai_papiers_chercher", { question: "mon passeport", inclure_n3: false }, "chat");
    expect(ferme.texte).not.toContain(NUMERO);
    expect(ferme.texte).toContain("(aucune pièce)");
  });

  it("un pluriel et un numéro partiel marchent ; un mot absent ne rend rien", async () => {
    expect((await appeler("memoryai_papiers_chercher", { question: "passeports", inclure_n3: true }, "chat")).texte).toContain(NUMERO);
    expect((await appeler("memoryai_papiers_chercher", { question: "passeport 2030", inclure_n3: true }, "chat")).texte).toContain(NUMERO);
    expect((await appeler("memoryai_papiers_chercher", { question: "passeport brésilien", inclure_n3: true }, "chat")).texte).not.toContain(NUMERO);
  });

  it("sans MEMORYAI_N3_CHAT, le chat non plus : l'interrupteur hors produit referme tout", async () => {
    const r = await appeler("memoryai_papiers_chercher", { question: "passeport", inclure_n3: true }, "chat", {});
    expect(r.texte).not.toContain(NUMERO);
  });

  it("la recherche en mémoire ne tourne QUE pour un lecteur qui lit N3 — pas même en sommaire", async () => {
    // ⚠️ Ce cas existe parce qu'une mutation est restée MUETTE : sans la condition « la
    // politique sert N3 », les autres cas passaient quand même, puisqu'un SOMMAIRE n'a ni type
    // ni résumé à comparer. Mais il a un domaine et des dates : « immigration 2030 » l'aurait
    // fait remonter au MCP par une recherche qui n'est pas la sienne — et déchiffré pour rien.
    const r = await appeler("memoryai_papiers_chercher", { question: "immigration 2030" }, "claude-ai");
    expect(r.texte).toContain("(aucune pièce)");
  });

  it("le MCP ne l'obtient pas par le plein texte", async () => {
    const r = await appeler("memoryai_papiers_chercher", { question: "passeport", inclure_n3: true }, "claude-ai");
    expect(r.texte).not.toContain(NUMERO);
  });
});

describe("rechercheEnMemoire (PUR)", () => {
  const p = (extra: Partial<PieceLisible>): PieceLisible => ({
    id: "x", forme: "complete", domaine: null, annee: null, langue: null, dateDocument: null, dateEcheance: null,
    niveau: 3, statut: "active", confiance: 1, extracteur: "t", type: null, emetteur: null, titulaire: null,
    titulaireConfiance: null, resume: null, champsStructures: null, champsLibres: null, exemplaires: [], ...extra,
  });

  it("ignore les mots vides, ramène un pluriel simple, dédoublonne", () => {
    expect(motsDeLaQuestion("Quel est le numéro de mon passeport ?")).toEqual(["numero", "passeport"]);
    expect(motsDeLaQuestion("passeports passeport")).toEqual(["passeport"]);
  });

  it("TOUS les mots doivent apparaître — un ET, pas un OU", () => {
    const pass = p({ type: "passeport", titulaire: "Jean Exemple" });
    expect(pieceCorrespond(pass, "passeport Exemple")).toBe(true);
    expect(pieceCorrespond(pass, "passeport Tremblay")).toBe(false);
  });

  it("une question sans mot significatif ne correspond à RIEN", () => {
    expect(pieceCorrespond(p({ type: "passeport" }), "de la")).toBe(false);
    expect(pieceCorrespond(p({ type: "passeport" }), "")).toBe(false);
  });

  it("les champs et leurs libellés comptent, accents ignorés", () => {
    const pass = p({ champsStructures: { numeros: [{ libelle: "numéro de passeport", valeur: "AB12" }] } });
    expect(pieceCorrespond(pass, "numero passeport")).toBe(true);
    expect(pieceCorrespond(pass, "ab12")).toBe(true);
  });
});

describe("ADR 0011 — l'écran du chat (LIA en atelier)", () => {
  const src = readFileSync(resolve(process.cwd(), "app/chat/ChatAtelier.tsx"), "utf8");

  it("la case N3 est COCHÉE par défaut quand l'interrupteur l'autorise, grisée sinon, et le serveur la revérifie", () => {
    expect(src).toMatch(/id: "n3"[\s\S]*?valeur: n3Possible,\s*desactive: !n3Possible/);
    // Anti-vacuité : la case existe toujours, décochable pour une conversation (c'est `reglages.n3` qui part).
    expect(src).toMatch(/inclureN3: n3Possible && \(reglages\?\.n3 \?\? n3Possible\) === true/);
  });

  it("le niveau 2 reste décoché par défaut, grisé sans MEMORYAI_N2_CHAT, et jamais envoyé sans elle", () => {
    expect(src).toMatch(/id: "n2"[\s\S]*?valeur: false,\s*desactive: !n2Possible/);
    expect(src).toMatch(/inclureN2: n2Possible && reglages\?\.n2 === true/);
  });

  it("l'écran ne dit plus que la conversation n'est pas gardée — c'est faux depuis l'ADR 0002", () => {
    expect(src).not.toContain("Rien de cette conversation");
    expect(src).toContain("tu la retrouves dans l’historique");
  });

  it("une nouvelle conversation remet l'identifiant à zéro (sinon la suite s'écrit dans l'ancienne)", () => {
    expect(src).toMatch(/nouveau: \(\) => \{[\s\S]*?conversationId\.current = null;/);
  });
});
