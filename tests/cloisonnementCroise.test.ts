// tests/cloisonnementCroise.test.ts — le cloisonnement entre apps, PROUVÉ (lot 2 de sécurité, 30/09/2026).
//
// Quatre propriétés, un bloc chacune, plus les tests d'ACCEPTATION de l'ADR 0015 (INC-31) :
//   1. l'app et le rôle viennent du NOM de la variable, jamais de la requête ; la restriction
//      posée par Marc sur une app (table `perimetres`) ne touche QU'elle ;
//   2. un jeton `_LECTURE` n'écrit rien ; un jeton d'écrivain n'ouvre pas le MCP ;
//   3. une configuration incomplète (variable vide, trop courte, nom mal formé) échoue FERMÉE ;
//   4. là où le code a promis l'indiscernabilité, la réponse est IDENTIQUE (code ET corps).
//
//   5. (INC-31) les papiers et leur file sont à DriveAI seule, en lecture comme en écriture ; la
//      lignée et la quarantaine se lisent dans l'app du JETON ; tout refus est `refusJeton()`.
//
// ⚠️ Le bloc 5 était `tests/cloisonnementTrous.test.ts`, en `it.fails` (commits 985d4f4 et
// f349bdd) : il énonçait la propriété voulue et passait tant qu'elle était FAUSSE. L'ADR 0015
// l'a rendue vraie ; ces cas sont désormais des `it` simples, et ils tombent si on défait la garde.
//
// Aucune donnée réelle : bases PGlite vides, jetons générés ici, valeurs d'essai.

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { appsConnues, identifierEcrivain, LONGUEUR_MIN_JETON, type Ecrivain } from "../lib/jetons";
import { depotDrizzle, type DepotFaits } from "../lib/depotFaits";
import { depotPerimetresDrizzle } from "../lib/depotPerimetres";
import { ecrireLot, EcritureRetireeError } from "../lib/ecrireFaits";
import { depotPiecesDrizzle, type DepotPieces } from "../lib/pieces/depot";
import { ecrireLotPieces, EcriturePiecesRetireeError } from "../lib/pieces/ecrire";
import { POST as postConversations } from "../app/api/conversations/route";
import { POST as postAvancement } from "../app/api/avancement/route";
import { GET as getFile, POST as postFile } from "../app/api/pieces/file/route";
import { POST as postMcp } from "../app/api/mcp/route";
import { POST as postFaits } from "../app/api/faits/route";
import { POST as postPieces } from "../app/api/pieces/route";
import { POST as postEvenements } from "../app/api/evenements/route";
import { POST as postAgenda } from "../app/api/agenda/route";
import { LIGNEE_EXTRACTEURS } from "../lib/pieces/lignee";
import { BON } from "./fixtures/faits";

/** Un jeton d'essai, frais à chaque appel : aucun jeton réel n'entre ici. */
const jeton = () => `essai-${randomBytes(18).toString("hex")}`;

const J = {
  driveaiEcriture: jeton(),
  driveaiLecture: jeton(),
  caraiEcriture: jeton(),
  claudecodeEcriture: jeton(),
  claudecodeLecture: jeton(),
};
const ENV: Record<string, string> = {
  MEMORYAI_TOKEN_DRIVEAI_ECRITURE: J.driveaiEcriture,
  MEMORYAI_TOKEN_DRIVEAI_LECTURE: J.driveaiLecture,
  MEMORYAI_TOKEN_CARAI_ECRITURE: J.caraiEcriture,
  MEMORYAI_TOKEN_CLAUDECODE_ECRITURE: J.claudecodeEcriture,
  MEMORYAI_TOKEN_CLAUDECODE_LECTURE: J.claudecodeLecture,
};

// ── Environnement des routes : posé par test, restauré après ────────────────────────────
const VARS = [...Object.keys(ENV), "MEMORYAI_GEL", "MEMORYAI_CHIFFREMENT", "DATABASE_URL", "MCP_SIGNING_KEY", "MCP_ACCESS_KEY"];
const sauvegarde = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
afterEach(() => {
  for (const v of VARS) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});
function poserEnv(): void {
  delete process.env.MEMORYAI_GEL;
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  process.env.MEMORYAI_CHIFFREMENT = randomBytes(32).toString("base64");
  // Jamais appelée : chaque cas de ce fichier se décide AVANT la base.
  process.env.DATABASE_URL = "postgres://jamais-appelee.invalid/x";
}

const requete = (url: string, j: string | null, corps: unknown = {}, methode = "POST") =>
  new Request(`http://memoryai.test${url}`, {
    method: methode,
    headers: { "content-type": "application/json", ...(j ? { authorization: `Bearer ${j}` } : {}) },
    ...(methode === "POST" ? { body: JSON.stringify(corps) } : {}),
  });

// ── Base PGlite vide, migrations du dépôt ───────────────────────────────────────────────
const cle = deriverCle(Buffer.alloc(32, 7).toString("base64"));
let pg: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
});

afterAll(async () => {
  await pg?.close();
});

const ecrivain = (appId: string, role: "ecriture" | "lecture" = "ecriture"): Ecrivain =>
  identifierEcrivain(J[`${appId}${role === "ecriture" ? "Ecriture" : "Lecture"}` as keyof typeof J], ENV) ??
  (() => {
    throw new Error(`jeton d'essai non reconnu : ${appId}/${role}`);
  })();

const fait = (ref: string) => ({ ...BON, valeur: "valeur-essai", provenance: { ...BON.provenance, source_ref: ref } });
const piece = (fileId: string) => ({
  type: "essai",
  emetteur: "emetteur-essai",
  annee: 2026,
  domaine: "99 · Essai",
  resume: "Pièce d'essai du cloisonnement.",
  exemplaires: [{ file_id: fileId, chemin: "/99 · Essai/cloisonnement" }],
  extracteur: "haiku-4.5-piece-v1",
});

/** Un dépôt qui échoue au PREMIER appel : prouve qu'un refus se décide avant toute lecture. */
function depotIntouchable<T extends object>(): T {
  return new Proxy({} as T, {
    get(_c, nom) {
      return () => {
        throw new Error(`dépôt touché : ${String(nom)}`);
      };
    },
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════
describe("1. l'identité vient du NOM de la variable, et la restriction de B ne touche que B", () => {
  it("chaque jeton est reconnu comme SON app et SON rôle, et rien d'autre", () => {
    expect(identifierEcrivain(J.driveaiEcriture, ENV)).toMatchObject({ appId: "driveai", role: "ecriture" });
    expect(identifierEcrivain(J.driveaiLecture, ENV)).toMatchObject({ appId: "driveai", role: "lecture" });
    expect(identifierEcrivain(J.caraiEcriture, ENV)).toMatchObject({ appId: "carai", role: "ecriture" });
    // Le plafond de fiabilité suit l'app du jeton : CarAI ne déclare pas un document officiel.
    expect(identifierEcrivain(J.caraiEcriture, ENV)!.fiabilites).toEqual(["app"]);
  });

  it("un jeton de conversation n'est PAS accordé à une autre app (refus commun, sans nom d'app)", async () => {
    poserEnv();
    const r = await postConversations(requete("/api/conversations", J.driveaiEcriture, { messages: [] }));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "non_autorise" });
  });

  it("Marc retire l'écriture à DriveAI : DriveAI est refusé, CarAI écrit toujours (faits)", async () => {
    const perimetres = depotPerimetresDrizzle(db);
    const t = new Date("2026-09-30T12:00:00Z");
    await perimetres.regler("driveai", { domaines: [], niveauMax: 0, role: "lecture", admetInvites: false, domicile: false }, t);
    try {
      await expect(ecrireLot([fait("croise-d1")], ecrivain("driveai"), cle, depotDrizzle(db))).rejects.toBeInstanceOf(
        EcritureRetireeError,
      );
      const r = await ecrireLot([fait("croise-c1")], ecrivain("carai"), cle, depotDrizzle(db));
      expect(r.refuses).toEqual([]);
      expect(r.acceptes).toBe(1);
    } finally {
      await perimetres.retirer("driveai");
    }
  });

  it("la même restriction, dans l'autre sens et sur les papiers", async () => {
    const perimetres = depotPerimetresDrizzle(db);
    const t = new Date("2026-09-30T12:00:00Z");
    await perimetres.regler("carai", { domaines: [], niveauMax: 0, role: "lecture", admetInvites: false, domicile: false }, t);
    try {
      await expect(ecrireLotPieces([piece("croise-p1")], ecrivain("carai"), cle, depotPiecesDrizzle(db))).rejects.toBeInstanceOf(
        EcriturePiecesRetireeError,
      );
      const r = await ecrireLotPieces([piece("croise-p2")], ecrivain("driveai"), cle, depotPiecesDrizzle(db));
      expect(r.refusees).toEqual([]);
      expect(r.acceptees).toBe(1);
    } finally {
      await perimetres.retirer("carai");
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
describe("2. un jeton de lecture n'écrit rien ; un jeton d'écrivain n'ouvre pas le MCP", () => {
  it("faits : refus AVANT de toucher la base", async () => {
    await expect(
      ecrireLot([fait("lecture-1")], ecrivain("driveai", "lecture"), cle, depotIntouchable<DepotFaits>()),
    ).rejects.toBeInstanceOf(EcritureRetireeError);
  });

  it("papiers : refus AVANT de toucher la base", async () => {
    await expect(
      ecrireLotPieces([piece("lecture-2")], ecrivain("driveai", "lecture"), cle, depotIntouchable<DepotPieces>()),
    ).rejects.toBeInstanceOf(EcriturePiecesRetireeError);
  });

  it("conversations, avancement, file de lecture : aucun jeton de lecture n'y passe", async () => {
    poserEnv();
    expect((await postConversations(requete("/api/conversations", J.claudecodeLecture, { messages: [] }))).status).toBe(401);
    expect((await postAvancement(requete("/api/avancement", J.driveaiLecture, {}))).status).toBe(401);
    expect((await getFile(requete("/api/pieces/file?extracteur=x&limite=1", J.driveaiLecture, null, "GET"))).status).toBe(401);
    expect((await postFile(requete("/api/pieces/file", J.driveaiLecture, { extracteur: "x", verdicts: [] }))).status).toBe(401);
  });

  it("le MCP ne connaît QUE son OAuth : aucun jeton d'app, d'écriture ou de lecture, ne l'ouvre", async () => {
    poserEnv();
    process.env.MCP_SIGNING_KEY = "s".repeat(48);
    process.env.MCP_ACCESS_KEY = "a".repeat(24);
    for (const j of Object.values(J)) {
      const r = await postMcp(
        new Request("https://memoryai.test/api/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${j}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
        }),
      );
      expect(r.status).toBe(401);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
describe("3. une configuration incomplète échoue FERMÉE", () => {
  const j = jeton();
  const casFermes: [string, Record<string, string>][] = [
    ["variable vide", { MEMORYAI_TOKEN_DRIVEAI_ECRITURE: "" }],
    ["variable d'espaces", { MEMORYAI_TOKEN_DRIVEAI_ECRITURE: "      " }],
    ["jeton trop court", { MEMORYAI_TOKEN_DRIVEAI_ECRITURE: j.slice(0, LONGUEUR_MIN_JETON - 1) }],
    ["rôle inconnu", { MEMORYAI_TOKEN_DRIVEAI_ADMIN: j }],
    ["app en minuscules", { MEMORYAI_TOKEN_driveai_ECRITURE: j }],
    ["app avec un séparateur", { MEMORYAI_TOKEN_DRIVE_AI_ECRITURE: j }],
    ["sans rôle", { MEMORYAI_TOKEN_DRIVEAI: j }],
    ["préfixe voisin", { MEMORYAI_TOKENS_DRIVEAI_ECRITURE: j }],
    ["suffixe en plus", { MEMORYAI_TOKEN_DRIVEAI_ECRITURE_2: j }],
  ];

  for (const [nom, env] of casFermes) {
    it(`${nom} : personne n'est reconnu, et la page /apps n'annonce aucun accès`, () => {
      const presente = Object.values(env)[0]!;
      expect(identifierEcrivain(presente, env)).toBeNull();
      expect(identifierEcrivain(j, env)).toBeNull();
      expect(appsConnues(env)).toEqual([]);
    });
  }

  it("aucune variable du tout : même un jeton long est refusé", () => {
    expect(identifierEcrivain(jeton(), {})).toBeNull();
  });

  it("jeton reçu vide, absent ou court : refusé même si une variable vide traîne", () => {
    const env = { MEMORYAI_TOKEN_DRIVEAI_ECRITURE: "" };
    for (const recu of [null, undefined, "", " ".repeat(LONGUEUR_MIN_JETON)]) {
      expect(identifierEcrivain(recu, env)).toBeNull();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
describe("4. là où l'indiscernabilité est promise, la réponse est identique", () => {
  it("avancement : jeton inconnu, absent, et jeton de lecture valide ⇒ même code, même corps", async () => {
    poserEnv();
    const corps: string[] = [];
    for (const j of [null, jeton(), J.driveaiLecture, J.claudecodeLecture]) {
      const r = await postAvancement(requete("/api/avancement", j, {}));
      expect(r.status).toBe(401);
      corps.push(await r.text());
    }
    expect(new Set(corps).size).toBe(1);
  });

  it("conversations : jeton inconnu, absent, et jeton de LECTURE de l'app autorisée ⇒ même réponse", async () => {
    poserEnv();
    const corps: string[] = [];
    for (const j of [null, jeton(), J.claudecodeLecture]) {
      const r = await postConversations(requete("/api/conversations", j, { messages: [] }));
      expect(r.status).toBe(401);
      corps.push(await r.text());
    }
    expect(new Set(corps).size).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
describe("5. INC-31 — tests d'acceptation de l'ADR 0015", () => {
  const piecePar = (fileId: string, extracteur: string) => ({ ...piece(fileId), extracteur });

  it("§2.1-2.2 : CarAI, en se déclarant d'un rang supérieur, ne remplace PAS un papier de DriveAI", async () => {
    const d = depotPiecesDrizzle(db);
    const r1 = await ecrireLotPieces([piecePar("acc-1", LIGNEE_EXTRACTEURS[1]!)], ecrivain("driveai"), cle, d);
    expect(r1.acceptees).toBe(1);
    const dernier = LIGNEE_EXTRACTEURS[LIGNEE_EXTRACTEURS.length - 1]!;
    // Refusé AVANT toute écriture : CarAI n'écrit pas de papier du tout.
    await expect(ecrireLotPieces([piecePar("acc-1", dernier)], ecrivain("carai"), cle, d)).rejects.toBeInstanceOf(
      EcriturePiecesRetireeError,
    );
    // Et DriveAI, elle, relit bien son propre papier au rang supérieur (ADR 0008 intact).
    const r3 = await ecrireLotPieces([piecePar("acc-1", dernier)], ecrivain("driveai"), cle, d);
    expect(r3.remplacees).toBe(1);
  });

  it("§2.2 : trois noms d'extracteur sous UN jeton ne valent pas trois sources", async () => {
    const d = depotDrizzle(db);
    let sortis: string[] = [];
    for (const [i, ext] of ["essai-a", "essai-b", "essai-c"].entries()) {
      const r = await ecrireLot(
        [{ ...fait(`acc-q-${i}`), predicat: "essaiacc.couleur", provenance: { ...BON.provenance, source_ref: `acc-q-${i}`, extracteur: ext } }],
        ecrivain("carai"),
        cle,
        d,
      );
      sortis = sortis.concat(r.sortisDeQuarantaine);
    }
    expect(sortis).toEqual([]);
  });

  describe("§2.3 : jeton inconnu, hors rôle, hors app ⇒ MÊME réponse, code et corps", () => {
    /** Base ABSENTE : un jeton qui passerait la garde recevrait un 503, et la différence se verrait. */
    function poserSansBase(): void {
      poserEnv();
      delete process.env.DATABASE_URL;
    }
    const corps = { faits: [], messages: [], pieces: [], extracteur: "x", verdicts: [] };
    const signature = async (r: Response) => `${r.status} ${await r.text()}`;
    const cas = [
      ["POST /api/faits", "/api/faits", "POST", postFaits, [J.driveaiLecture]],
      ["POST /api/conversations", "/api/conversations", "POST", postConversations, [J.driveaiEcriture, J.claudecodeLecture]],
      ["POST /api/pieces", "/api/pieces", "POST", postPieces, [J.caraiEcriture, J.driveaiLecture]],
      ["GET /api/pieces/file", "/api/pieces/file?extracteur=x&limite=1", "GET", getFile, [J.caraiEcriture, J.driveaiLecture]],
      ["POST /api/pieces/file", "/api/pieces/file", "POST", postFile, [J.caraiEcriture, J.driveaiLecture]],
      ["POST /api/avancement", "/api/avancement", "POST", postAvancement, [J.driveaiLecture]],
      ["POST /api/evenements", "/api/evenements", "POST", postEvenements, [J.caraiEcriture, J.claudecodeEcriture, J.driveaiLecture]],
      ["POST /api/agenda", "/api/agenda", "POST", postAgenda, [J.caraiEcriture, J.claudecodeEcriture, J.driveaiLecture]],
    ] as const;

    for (const [nom, url, methode, route, refuses] of cas) {
      it(`${nom} : aucun nom d'app, aucun message, rien qui distingue`, async () => {
        poserSansBase();
        const attendu = await signature(await route(requete(url, jeton(), methode === "GET" ? null : corps, methode)));
        expect(attendu).toBe('401 {"error":"non_autorise"}');
        expect(await signature(await route(requete(url, null, methode === "GET" ? null : corps, methode)))).toBe(attendu);
        for (const j of refuses) {
          expect(await signature(await route(requete(url, j, methode === "GET" ? null : corps, methode)))).toBe(attendu);
        }
      });
    }

    it("contre-épreuve : le BON jeton passe la garde et atteint la panne de base (503), pas le refus", async () => {
      poserSansBase();
      const r = await postPieces(requete("/api/pieces", J.driveaiEcriture, corps));
      expect(r.status).toBe(503);
      const g = await getFile(requete("/api/pieces/file?extracteur=x&limite=1", J.driveaiEcriture, null, "GET"));
      expect(g.status).toBe(503);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
describe("6. migration 0021 — les papiers d'avant la 0020 reçoivent leur app (ADR 0015 §3)", () => {
  const sql0021 = readFileSync(resolve(process.cwd(), "drizzle", "0021_ecrivain_des_papiers_existants.sql"), "utf8")
    .split("--> statement-breakpoint")
    .filter((s) => s.trim());
  const rejouer = async () => {
    for (const s of sql0021) await pg.exec(s);
  };
  const appDe = async (id: string) =>
    (await pg.query<{ ecrivain_app: string | null }>(`select ecrivain_app from pieces where id = $1`, [id])).rows[0]!.ecrivain_app;

  it("un papier ancien SANS app ne se relit pas ; après la 0021, DriveAI le relit — et rejouer ne change rien", async () => {
    const d = depotPiecesDrizzle(db);
    const v1 = LIGNEE_EXTRACTEURS[1]!;
    const dernier = LIGNEE_EXTRACTEURS[LIGNEE_EXTRACTEURS.length - 1]!;
    const lu = await ecrireLotPieces([{ ...piece("m21-lu"), extracteur: v1 }], ecrivain("driveai"), cle, d);
    const inv = await ecrireLotPieces([{ ...piece("m21-inv"), extracteur: "moteur-inventaire-v1" }], ecrivain("driveai"), cle, d);
    const idLu = lu.idsCrees[0]!;
    const idInv = inv.idsCrees[0]!;
    // Simule l'état d'AVANT la 0020 : aucune app.
    await pg.query(`update pieces set ecrivain_app = null where id in ($1, $2)`, [idLu, idInv]);

    // Côté sûr tant que la 0021 n'est pas passée : la vraie lecture sans app ne se remplace pas.
    const avant = await ecrireLotPieces([{ ...piece("m21-lu"), extracteur: dernier }], ecrivain("driveai"), cle, d);
    expect(avant).toMatchObject({ remplacees: 0, dejaPresentes: 1 });

    await rejouer();
    expect(await appDe(idLu)).toBe("driveai");
    expect(await appDe(idInv)).toBe("migration-inventaire");
    await rejouer();
    expect(await appDe(idLu)).toBe("driveai");

    const apres = await ecrireLotPieces([{ ...piece("m21-lu"), extracteur: dernier }], ecrivain("driveai"), cle, d);
    expect(apres.remplacees).toBe(1);
  });
});
