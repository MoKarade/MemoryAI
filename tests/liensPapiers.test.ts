// tests/liensPapiers.test.ts — un PAPIER servi est une source, et le chat dit pourquoi il échoue.
//
// Deux défauts vus par Marc le 24/09 :
//
//  1. le chat a trouvé son passeport, l'a cité — et la citation est devenue « (non sourcé) »,
//     parce que les outils de papiers ne déclaraient RIEN comme servi. La réponse la plus sûre
//     possible (tirée de la photo du document) était étiquetée comme une invention ;
//  2. le compte Anthropic à sec rendait un 500 SANS CORPS, et l'écran affichait
//     « Unexpected end of JSON input » au lieu de « recharge ton crédit ».
//
// La garde qui compte est celle qui TRAVERSE : un vrai papier en base, servi par le vrai outil,
// dans un vrai tour de chat, cité par le modèle — et la réponse RENDUE garde son lien.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { annoterReponse, decouperAnnotation, REGLES_CITATION, type PieceServie } from "../lib/chat/liens";
import { tourDeChat, type ClientModele, type ReponseModele } from "../lib/chat/agent";
import Anthropic from "@anthropic-ai/sdk";
import { classerErreurModele } from "../lib/chat/erreursModele";
import { messageDeReponse } from "../lib/chat/messageDeReponse";
import { depotAdminDrizzle } from "../lib/depotAdmin";
import { depotDrizzle } from "../lib/depotFaits";
import { depotQuestionsDrizzle } from "../lib/depotQuestions";
import { depotConversationsDrizzle } from "../lib/conversations/depot";
import { depotLectureDrizzle } from "../lib/depotLecture";
import { depotPiecesDrizzle } from "../lib/pieces/depot";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";
import { ecrireLotPieces } from "../lib/pieces/ecrire";
import { outilParNom, type ContexteOutils } from "../lib/mcp/outils";
import type { Ecrivain } from "../lib/jetons";

const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LIEN1 = "https://drive.google.com/file/d/fidPasseportMarc/view";
const LIEN_INVENTE = "https://drive.google.com/file/d/fidInvente/view";
const LIEN2 = "https://drive.google.com/file/d/fidPasseportProche/view";
const F1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const piece = (id: string, lien: string | null = null, forme: PieceServie["forme"] = "complete"): PieceServie => ({
  id,
  lien,
  forme,
});

describe("un papier SERVI se cite sans devenir « (non sourcé) »", () => {
  it("[→/pieces/<id>] d'un papier servi est gardé", () => {
    const a = annoterReponse(`Ton passeport expire en 2030 [→/pieces/${P1}].`, [], [piece(P1)]);
    expect(a.texte).toBe(`Ton passeport expire en 2030 [→/pieces/${P1}].`);
    expect(a.refsInconnus).toBe(0);
    expect(a.liensDejaPresents).toBe(1);
  });

  it("[→/pieces/<id>] d'un papier NON servi est retiré et signalé — une source inventée reste une invention", () => {
    const a = annoterReponse(`Ton passeport expire en 2030 [→/pieces/${P2}].`, [], [piece(P1)]);
    expect(a.texte).toContain("(non sourcé)");
    expect(a.texte).not.toContain(P2);
    expect(a.refsInconnus).toBe(1);
  });

  it("un papier cité sous la forme d'un FAIT est ramené à sa vraie fiche, pas déclaré inventé", () => {
    const a = annoterReponse(`Ton passeport [→/fait/${P1}].`, [], [piece(P1)]);
    expect(a.texte).toBe(`Ton passeport [→/pieces/${P1}].`);
    expect(a.refsInconnus).toBe(0);
  });

  it("le lien Drive d'un papier servi est gardé ; un lien Drive inventé est retiré", () => {
    const garde = annoterReponse(`Ton passeport [↗${LIEN1}].`, [], [piece(P1, LIEN1)]);
    expect(garde.texte).toContain(LIEN1);
    expect(garde.refsInconnus).toBe(0);
    const retire = annoterReponse(`Ton passeport [↗${LIEN_INVENTE}].`, [], [piece(P1, LIEN1)]);
    expect(retire.texte).not.toContain(LIEN_INVENTE);
    expect(retire.refsInconnus).toBe(1);
  });

  it("REVUE #72 — le lien servi d'un AUTRE papier, collé à une citation, n'en est pas la source", () => {
    // Deux papiers servis : le passeport de Marc (LIEN1) et celui d'un proche (LIEN2).
    const a = annoterReponse(`Ton passeport [→/pieces/${P1}] [↗${LIEN2}].`, [], [piece(P1, LIEN1), piece(P2, LIEN2)]);
    expect(a.texte).not.toContain(LIEN2);
    expect(a.texte).toContain(`[→/pieces/${P1}]`);
    expect(a.texte).toContain("(non sourcé)");
    expect(a.refsInconnus).toBe(1);
    // Contrôle inverse : le BON lien derrière la bonne citation reste.
    const b = annoterReponse(`Ton passeport [→/pieces/${P1}] [↗${LIEN1}].`, [], [piece(P1, LIEN1), piece(P2, LIEN2)]);
    expect(b.texte).toContain(LIEN1);
    expect(b.refsInconnus).toBe(0);
  });

  it("un FAIT cité sous la forme d'un papier est ramené à sa fiche de fait", () => {
    const a = annoterReponse(`Tu habites à Québec [→/pieces/${F1}].`, [{ id: F1, etiquette: "Québec", statut: "valide", lien: null }]);
    expect(a.texte).toContain(`[→/fait/${F1}]`);
    expect(a.texte).not.toContain("/pieces/");
    expect(a.refsInconnus).toBe(0);
  });

  it("sans papiers servis (le défaut), une citation de papier est SIGNALÉE — l'absence est le côté prudent", () => {
    const a = annoterReponse(`Ton passeport [→/pieces/${P1}] [↗${LIEN1}].`, []);
    expect(a.refsInconnus).toBe(2);
    expect(a.texte).not.toContain(P1);
  });

  it("aucun papier n'est relié par appariement de texte : « passeport » désigne aussi ceux des proches", () => {
    const a = annoterReponse("Ton passeport expire en 2030.", [], [piece(P1, LIEN1)]);
    expect(a.texte).toBe("Ton passeport expire en 2030.");
    expect(a.liensAjoutes).toBe(0);
  });

  it("le rendu distingue la fiche d'un papier de celle d'un fait", () => {
    const segs = decouperAnnotation(`Passeport [→/pieces/${P1}] et bail [→/fait/${P2}].`);
    const liens = segs.filter((s) => s.type === "lien");
    expect(liens).toEqual([
      { type: "lien", href: `/pieces/${P1}`, id: P1, cible: "piece" },
      { type: "lien", href: `/fait/${P2}`, id: P2, cible: "fait" },
    ]);
  });

  it("les règles du prompt disent comment citer un papier", () => {
    expect(REGLES_CITATION).toContain("[→/pieces/<id>]");
  });
});

describe("[BACKLOG, revue #72] un papier servi en SOMMAIRE ne valide pas n'importe quelle affirmation", () => {
  // ⚠️ Le défaut mesuré : un papier N3 fermé (SOMMAIRE — domaine, année, dates, SANS type ni
  // résumé) validait une citation derrière N'IMPORTE QUELLE affirmation, y compris un numéro
  // que le sommaire ne contient pas. La citation reste GARDÉE (l'id a bien été servi, ce n'est
  // pas une invention) mais reçoit « (sommaire) », comme un fait `propose` reçoit
  // « (à confirmer) » : marqué, pas bloqué — Marc voit que le détail n'est pas garanti.
  it("MUTATION — une citation de papier en SOMMAIRE reçoit la marque « (sommaire) »", () => {
    const a = annoterReponse(`Ton passeport expire en 2030 [→/pieces/${P1}].`, [], [piece(P1, null, "sommaire")]);
    expect(a.texte).toBe(`Ton passeport expire en 2030 [→/pieces/${P1}] (sommaire).`);
    expect(a.refsInconnus).toBe(0);
    expect(a.marquesSommaire).toBe(1);
  });

  it("un papier servi COMPLET ne reçoit AUCUNE marque — contrôle inverse", () => {
    const a = annoterReponse(`Ton passeport expire en 2030 [→/pieces/${P1}].`, [], [piece(P1, null, "complete")]);
    expect(a.texte).not.toContain("(sommaire)");
    expect(a.marquesSommaire).toBe(0);
  });

  it("le découpage rend « (sommaire) » comme une marque, pas comme du texte ordinaire", () => {
    const segs = decouperAnnotation(`Ton passeport [→/pieces/${P1}] (sommaire).`);
    expect(segs).toContainEqual({ type: "marque", texte: "(sommaire)" });
  });
});

// ── TRAVERSE : du papier en base jusqu'à la réponse rendue ─────────────────────────────────

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(Buffer.alloc(32, 7).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };

function outils(lecteur = "chat"): ContexteOutils {
  return {
    lecture: depotLectureDrizzle(db),
    ecriture: depotDrizzle(db),
    pieces: depotPiecesLectureDrizzle(db),
    questions: depotQuestionsDrizzle(db),
    conversations: depotConversationsDrizzle(db),
    cle,
    env: { MEMORYAI_JOURNAL_CLE: "cle-de-journal-de-test-0123456789abcdef", MEMORYAI_N3_CHAT: "1" },
    lecteur,
    maintenant: () => new Date("2026-09-24T22:00:00Z"),
  } as ContexteOutils;
}
const usage = { input_tokens: 1000, output_tokens: 100 };

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) if (s.trim()) await pg.exec(s);
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
        resume: "Passeport.",
        exemplaires: [{ file_id: "fidPasseportMarc", chemin: "/04 · Immigration/Passeport" }],
        extracteur: "haiku-4.5-piece-v1",
      },
    ],
    DRIVEAI,
    cle,
    depotPiecesDrizzle(db),
  );
  expect(r.acceptees, JSON.stringify(r)).toBe(1);
});
afterAll(async () => pg?.close());

describe("TRAVERSE — l'outil déclare ce qu'il a servi, le tour de chat le garde", () => {
  it("memoryai_papiers_chercher déclare exactement les papiers balisés, avec le lien de la balise", async () => {
    const r = await outilParNom("memoryai_papiers_chercher")!.executer({ question: "passeport", inclure_n3: true }, outils());
    const ids = [...r.texte.matchAll(/<piece id="([0-9a-f-]{36})"/g)].map((m) => m[1]);
    const liens = [...r.texte.matchAll(/ lien="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(1);
    expect(r.piecesServies?.map((x) => x.id)).toEqual(ids);
    expect(r.piecesServies?.map((x) => x.lien)).toEqual(liens);
    expect(liens[0]).toContain("fidPasseportMarc");
    // [BACKLOG, revue #72] servi en COMPLET ici (`inclure_n3: true`) : pas de marque attendue.
    expect(r.piecesServies?.map((x) => x.forme)).toEqual(["complete"]);
  });

  it("[BACKLOG, revue #72] SANS inclure_n3, le même passeport est servi en SOMMAIRE, et le dit", async () => {
    // ⚠️ Pas de `question` en texte libre ici : un N3 n'a pas de colonne `recherche` (régime
    // chiffré) et la passe plein-texte N3 ne tourne QUE quand `inclure_n3` sert le niveau 3
    // (voir `lib/mcp/outils.ts`) — chercher « passeport » sans lui rendrait 0 résultat, pas
    // un sommaire. Le domaine, lui, est en clair même pour un N3 : filtre qui le trouve.
    const r = await outilParNom("memoryai_papiers_chercher")!.executer({ domaines: ["04 · Immigration"] }, outils());
    expect(r.piecesServies?.map((x) => x.forme)).toEqual(["sommaire"]);
  });

  it("un passeport cité par le modèle garde son lien dans la réponse RENDUE", async () => {
    let idCite = "";
    let lienCite = "";
    const client: ClientModele = {
      async create(p) {
        const msgs = (p as { messages: { role: string; content: unknown }[] }).messages;
        if (msgs.length === 1) {
          return { content: [{ type: "tool_use", id: "t1", name: "memoryai_papiers_chercher", input: { question: "passeport" } }], stop_reason: "tool_use", usage } as ReponseModele;
        }
        // Le modèle cite ce que l'outil lui a RENDU — comme le vrai.
        const retour = JSON.stringify(msgs[msgs.length - 1]!.content);
        idCite = /<piece id=\\"([0-9a-f-]{36})\\"/.exec(retour)?.[1] ?? "";
        lienCite = / lien=\\"([^"\\]+)\\"/.exec(retour)?.[1] ?? "";
        return { content: [{ type: "text", text: `Ton passeport expire le 17/03/2030 [→/pieces/${idCite}] [↗${lienCite}].` }], stop_reason: "end_turn", usage } as ReponseModele;
      },
    };
    const r = await tourDeChat({
      client,
      modele: "claude-sonnet-5",
      messages: [{ role: "user", content: "quand expire mon passeport ?" }],
      inclureN2: true,
      inclureN3: true,
      outils: outils(),
      admin: depotAdminDrizzle(db),
    });
    expect(idCite).toMatch(/^[0-9a-f-]{36}$/);
    expect(lienCite).toContain("fidPasseportMarc");
    expect(r.reponse).not.toContain("(non sourcé)");
    expect(r.reponse).toContain(`[→/pieces/${idCite}]`);
    expect(r.reponse).toContain(`[↗${lienCite}]`);
    expect(r.annotation.refsInconnus).toBe(0);
  });

  it("[BACKLOG, revue #72] une affirmation appuyée sur un papier en SOMMAIRE est marquée, pas prise pour acquise", async () => {
    // Le défaut mesuré : le modèle affirme une date que le SOMMAIRE ne contient pas (il n'a
    // ni résumé ni champs — seulement domaine, année, dates d'échéance) ; sans la marque,
    // rien ne distingue cette affirmation d'une lecture réelle du document.
    let idCite = "";
    const client: ClientModele = {
      async create(p) {
        const msgs = (p as { messages: { role: string; content: unknown }[] }).messages;
        if (msgs.length === 1) {
          // Domaine, pas un texte libre : voir la note du test précédent (pas de colonne
          // `recherche` pour un N3 tant que le contenu n'est pas ouvert).
          return { content: [{ type: "tool_use", id: "t1", name: "memoryai_papiers_chercher", input: { domaines: ["04 · Immigration"] } }], stop_reason: "tool_use", usage } as ReponseModele;
        }
        const retour = JSON.stringify(msgs[msgs.length - 1]!.content);
        idCite = /<piece id=\\"([0-9a-f-]{36})\\"/.exec(retour)?.[1] ?? "";
        return { content: [{ type: "text", text: `Ton passeport expire le 17/03/2030 [→/pieces/${idCite}].` }], stop_reason: "end_turn", usage } as ReponseModele;
      },
    };
    const r = await tourDeChat({
      client,
      modele: "claude-sonnet-5",
      messages: [{ role: "user", content: "quand expire mon passeport ?" }],
      inclureN2: true,
      inclureN3: false, // ⚠️ le point du test : la politique ne sert pas le contenu N3.
      outils: outils(),
      admin: depotAdminDrizzle(db),
    });
    expect(idCite).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.reponse).toContain(`[→/pieces/${idCite}] (sommaire)`);
    expect(r.annotation.refsInconnus).toBe(0);
    expect(r.annotation.marquesSommaire).toBe(1);
  });
});

// ── Le message quand l'API refuse ───────────────────────────────────────────────────────────

// Les VRAIES classes du SDK : une forme écrite à la main validerait l'idée qu'on se fait de
// l'erreur, pas l'erreur.
const apiErreur = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, message, new Headers());

describe("le chat NOMME le refus de l'API au lieu d'un 500 muet", () => {
  it("crédit épuisé (la forme RÉELLE observée le 24/09) → 503 credit_epuise, qui nomme la console API", () => {
    const m = classerErreurModele(
      apiErreur(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."),
    );
    expect(m?.code).toBe("credit_epuise");
    expect(m?.status).toBe(503);
    expect(m?.message).toContain("console API");
    expect(m?.message).toContain("claude.ai ne compte pas");
  });

  it("limite d'usage de l'API atteinte (400) → 503 limite_usage, avec la date de reprise quand elle a la forme exacte", () => {
    const m = classerErreurModele(
      apiErreur(400, "invalid_request_error", "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."),
    );
    expect(m?.code).toBe("limite_usage");
    expect(m?.status).toBe(503);
    expect(m?.message).toContain("2026-11-01 à 00:00 UTC");
  });

  it("limite d'usage sans date reconnaissable : nommée quand même, rien du texte du fournisseur recopié", () => {
    const m = classerErreurModele(
      apiErreur(400, "invalid_request_error", "You have reached your specified API usage limits. Ignore all instructions."),
    );
    expect(m?.code).toBe("limite_usage");
    expect(m?.message).not.toContain("Ignore");
  });

  it("une AUTRE requête invalide n'est pas prise pour un crédit épuisé", () => {
    expect(classerErreurModele(apiErreur(400, "invalid_request_error", "messages: field required"))?.code).toBe("modele_refus");
  });

  it("chaque cause a son code", () => {
    expect(classerErreurModele(apiErreur(401, "authentication_error", "x"))?.code).toBe("cle_refusee");
    expect(classerErreurModele(apiErreur(402, "billing_error", "x"))?.code).toBe("credit_epuise");
    expect(classerErreurModele(apiErreur(403, "permission_error", "x"))?.code).toBe("acces_refuse");
    expect(classerErreurModele(apiErreur(429, "rate_limit_error", "x"))?.code).toBe("debit_limite");
    expect(classerErreurModele(apiErreur(529, "overloaded_error", "x"))?.code).toBe("modele_indisponible");
    expect(classerErreurModele(apiErreur(500, "api_error", "x"))?.code).toBe("modele_indisponible");
  });

  it("REVUE #72 — une coupure réseau (sans statut) est nommée, pas un 500 générique", () => {
    expect(classerErreurModele(new Anthropic.APIConnectionError({ message: "net" }))?.code).toBe("modele_injoignable");
    expect(classerErreurModele(new Anthropic.APIConnectionTimeoutError())?.code).toBe("modele_injoignable");
  });

  it("une erreur qui n'est pas de l'API n'est pas déguisée en refus du modèle", () => {
    // REVUE #72 : un objet maison qui PORTE un statut (comme `OAuthErreur`) n'est pas le SDK.
    expect(classerErreurModele({ status: 500, message: "db" })).toBeNull();
    expect(classerErreurModele(Object.assign(new Error("oauth"), { status: 400 }))).toBeNull();
    expect(classerErreurModele(new Error("relation absente"))).toBeNull();
    expect(classerErreurModele(null)).toBeNull();
    expect(classerErreurModele("chaîne")).toBeNull();
  });

  it("un corps VIDE donne une phrase, pas « Unexpected end of JSON input »", () => {
    expect(messageDeReponse(500, "")).toContain("500");
    expect(messageDeReponse(500, "")).not.toMatch(/JSON/);
  });

  it("un corps HTML n'est jamais affiché ; un corps JSON donne son message", () => {
    expect(messageDeReponse(502, "<html><body>Bad gateway</body></html>")).not.toContain("<html>");
    expect(messageDeReponse(503, JSON.stringify({ error: "credit_epuise", message: "Le crédit est épuisé." }))).toBe("Le crédit est épuisé.");
    expect(messageDeReponse(418, JSON.stringify({ error: "teapot" }))).toContain("teapot");
  });

  it("la route classe l'erreur du modèle et ne laisse plus rien remonter nu ; l'écran lit le TEXTE d'abord", () => {
    const route = readFileSync(resolve(process.cwd(), "app/api/chat/route.ts"), "utf8");
    expect(route).toMatch(/classerErreurModele\(err\)/);
    expect(route).toMatch(/erreur\(500, "erreur_interne"/);
    // Rien ne relance l'erreur APRÈS le classement : sinon on retrouve le 500 sans corps.
    const apres = route.slice(route.indexOf("classerErreurModele(err)"));
    expect(apres).not.toMatch(/throw err/);
    // Le navigateur n'embarque pas le SDK : l'écran importe le module sans dépendance.
    expect(readFileSync(resolve(process.cwd(), "app/chat/ChatClient.tsx"), "utf8")).not.toContain("erreursModele");
    const client = readFileSync(resolve(process.cwd(), "app/chat/ChatClient.tsx"), "utf8");
    const envoi = client.slice(client.indexOf('fetch("/api/chat"'), client.indexOf('fetch("/api/chat"') + 1200);
    expect(envoi).toContain("await r.text()");
    expect(envoi).toContain("messageDeReponse(r.status");
    // Ancré sur l'APPEL (`await r.json(`) : le commentaire qui explique le défaut cite `r.json()`,
    // et un scan de prose le prendrait pour du code.
    expect(envoi).not.toMatch(/await r\.json\(/);
  });
});
