// tests/routeEtat.test.ts — GET /api/etat : ce que la mémoire répond à une app qui
// l'alimente, et ce qu'elle refuse de répondre.
//
// Deux moitiés, parce qu'elles se cassent pour des raisons différentes :
//   1. la couche HTTP (qui entre, et ce qui se passe quand la base manque) ;
//   2. la COMPOSITION, pure — c'est elle qui décide quels nombres sortent, donc elle qui
//      pourrait publier un cumul amputé ou taire les faits migrés.
//
// Les mutations qui doivent rougir sont nommées dans les titres.

import { describe, it, expect, afterEach } from "vitest";
import { GET } from "../app/api/etat/route";
import { composerEtatPublic } from "../lib/etatPublic";
import { ROUTES_A_AUTH_PROPRE, isPublicPath } from "../lib/authGuard";
import { readFileSync } from "node:fs";

const JETON = "jeton-driveai-0123456789abcdef";
const VARS = ["MEMORYAI_GEL", "MEMORYAI_TOKEN_DRIVEAI_LECTURE", "MEMORYAI_TOKEN_DRIVEAI_ECRITURE", "DATABASE_URL"] as const;
const sauvegarde = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));

afterEach(() => {
  for (const v of VARS) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});

function requete(jeton: string | null = JETON): Request {
  return new Request("http://memoryai.test/api/etat", {
    method: "GET",
    headers: jeton ? { authorization: `Bearer ${jeton}` } : {},
  });
}

describe("GET /api/etat — la couche HTTP", () => {
  it("401 INDISCERNABLE : jeton absent, faux, tronqué, ou variable absente", async () => {
    delete process.env.MEMORYAI_GEL;
    process.env.MEMORYAI_TOKEN_DRIVEAI_LECTURE = JETON;
    const corps: string[] = [];
    for (const j of [null, "faux-jeton-0123456789abcdef", JETON.slice(0, 10)]) {
      const r = await GET(requete(j));
      expect(r.status).toBe(401);
      corps.push(await r.text());
    }
    delete process.env.MEMORYAI_TOKEN_DRIVEAI_LECTURE;
    const r = await GET(requete(JETON));
    expect(r.status).toBe(401);
    corps.push(await r.text());
    // Quatre refus, UNE seule réponse : distinguer ferait de cette route un oracle qui dit
    // à un inconnu s'il a trouvé un nom de variable.
    expect(new Set(corps).size).toBe(1);
  });

  it("un jeton de LECTURE suffit — c'est le plus petit droit qui répond à la question", async () => {
    delete process.env.MEMORYAI_GEL;
    delete process.env.MEMORYAI_TOKEN_DRIVEAI_ECRITURE;
    process.env.MEMORYAI_TOKEN_DRIVEAI_LECTURE = JETON;
    delete process.env.DATABASE_URL;
    const r = await GET(requete());
    // Pas 401 : le jeton est reconnu. On s'arrête sur la base, qui est l'étape d'après.
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("base_absente");
  });

  it("503 base_absente — une panne, JAMAIS des zéros qui se liraient « la mémoire est vide »", async () => {
    delete process.env.MEMORYAI_GEL;
    process.env.MEMORYAI_TOKEN_DRIVEAI_LECTURE = JETON;
    delete process.env.DATABASE_URL;
    const r = await GET(requete());
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j.error).toBe("base_absente");
    // Le contrôle qui compte : aucun compte n'est rendu. Un `informations: 0` ici serait le
    // cumul amputé que `totalInformations` existe pour refuser.
    expect(j.informations).toBeUndefined();
    expect(j.faits).toBeUndefined();
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("LE GEL NE BLOQUE PAS cette route — contrairement à /api/faits, et c'est délibéré", async () => {
    process.env.MEMORYAI_GEL = "1";
    process.env.MEMORYAI_TOKEN_DRIVEAI_LECTURE = JETON;
    delete process.env.DATABASE_URL;
    const r = await GET(requete());
    // Si le gel court-circuitait, on lirait `memoire_gelee` au lieu de la panne de base.
    // Répondre 503 gelée ici cacherait l'état au moment précis où l'on cherche à comprendre
    // pourquoi plus rien n'avance — c'est-à-dire quand cette route sert.
    expect((await r.json()).error).toBe("base_absente");
  });
});

describe("GET /api/etat — le chaînon avec le garde de session", () => {
  it("la route est publique ET hors du matcher : sous le garde, DriveAI recevrait du HTML", () => {
    // Le piège n°1 du squelette, vécu par JobAI : une route appelée par une machine qui tombe
    // sous le garde de session reçoit une REDIRECTION vers /login au lieu du JSON, et
    // l'appelant affiche « injoignable » alors que l'app va parfaitement bien.
    expect(ROUTES_A_AUTH_PROPRE).toContain("/api/etat");
    expect(isPublicPath("/api/etat")).toBe(true);
    const mw = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
    expect(mw).toContain("api/etat$");
    // ⚠️ L'ancrage `$` n'est pas décoratif : sans lui, `/api/etat/quoi-que-ce-soit` sortirait
    // aussi du garde. Une route ajoutée demain sous ce préfixe doit tomber du côté GARDÉ.
    expect(isPublicPath("/api/etat/tout")).toBe(false);
  });
});

describe("composerEtatPublic — notesLia", () => {
  const f = { parStatut: { valide: 1 }, canaris: 0, dernierValideLe: null, migresEnPiece: 0 };
  const args = [f, { total: 1 }, { lus: 1, nonLus: 0 }, false, { faits: 0, papiers: 0 }] as const;

  it("valide : le nombre sort, seul, 0 compris", () => {
    expect(composerEtatPublic(...args, undefined, undefined, { nonLues: 2 }).notesLia).toEqual({ nonLues: 2 });
    expect(composerEtatPublic(...args, undefined, undefined, { nonLues: 0 }).notesLia).toEqual({ nonLues: 0 });
  });

  it("rejeté : absent quand le compte n'est pas fourni, jamais un 0 inventé", () => {
    const e = composerEtatPublic(...args);
    expect("notesLia" in e).toBe(false);
    expect(JSON.stringify(e)).not.toContain("nonLues");
  });
});

describe("composerEtatPublic — ce qui sort, et ce qui ne sort pas", () => {
  const faits = {
    parStatut: { valide: 343, propose: 4, rejete: 7 },
    canaris: 0,
    dernierValideLe: "2026-09-22T04:08:17.395Z",
    migresEnPiece: 2646,
  };
  const papiers = { total: 2748 };
  const extracteurs = { lus: 590, nonLus: 2158 };
  const parLia = { faits: 12, papiers: 34 };

  it("publie les deux unités SÉPARÉMENT et leur somme", () => {
    const e = composerEtatPublic(faits, papiers, extracteurs, false, parLia);
    expect(e.faits.valides).toBe(343);
    expect(e.papiers.total).toBe(2748);
    // La somme est celle de la source unique, jamais une seconde addition écrite ici.
    expect(e.informations).toBe(343 + 2748);
  });

  it("distingue LU de IMPORTÉ — la demande de Marc du 23/09, mot pour mot", () => {
    const e = composerEtatPublic(faits, papiers, extracteurs, false, parLia);
    expect(e.papiers.lus).toBe(590);
    expect(e.papiers.importesSeulement).toBe(2158);
    // Les deux se somment au total : un papier est lu ou il ne l'est pas.
    expect(e.papiers.lus + e.papiers.importesSeulement).toBe(e.papiers.total);
  });

  it("publie les faits MIGRÉS — sans eux, une chute de 94 % ressemble à une perte de données", () => {
    const e = composerEtatPublic(faits, papiers, extracteurs, false, parLia);
    expect(e.faits.migresEnPiece).toBe(2646);
  });

  it("un statut absent vaut 0, jamais `undefined` qui casserait une addition chez l'appelant", () => {
    const e = composerEtatPublic({ ...faits, parStatut: {} }, papiers, extracteurs, false, parLia);
    expect(e.faits.valides).toBe(0);
    expect(e.faits.aValider).toBe(0);
  });

  it("le gel est PUBLIÉ, pas appliqué", () => {
    expect(composerEtatPublic(faits, papiers, extracteurs, true, parLia).gele).toBe(true);
    expect(composerEtatPublic(faits, papiers, extracteurs, false, parLia).gele).toBe(false);
  });

  it("Marc ne juge plus rien : « à juger par Marc » vaut 0, ce que LIA a tranché se compte (tâche MemoryAI 231)", () => {
    const e = composerEtatPublic(faits, papiers, extracteurs, false, parLia);
    expect(e.jugement).toEqual({ aJugerParMarc: 0, faitsParLia: 12, papiersParLia: 34 });
    // Même avec des faits proposés, rien n'est posé à Marc.
    expect(e.faits.aValider).toBe(4);
    expect(e.jugement.aJugerParMarc).toBe(0);
  });

  it("AUCUN contenu ne sort : pas de valeur, pas de prédicat, pas de nom de fichier", () => {
    const e = composerEtatPublic(faits, papiers, extracteurs, false, parLia);
    // Le contrôle porte sur la FORME de ce qui est publié : tout doit être un nombre, un
    // booléen, ou l'horodatage de traitement. Un champ texte ajouté demain le fait rougir,
    // et c'est exactement le moment où quelqu'un doit se demander s'il traverse la frontière.
    const plat = JSON.stringify(e);
    expect(plat).not.toMatch(/\.pdf|\.jpg|Banque Aurore/i);
    for (const v of Object.values(e.faits)) {
      if (v === null) continue;
      expect(typeof v === "number" || v === faits.dernierValideLe).toBe(true);
    }
    for (const v of Object.values(e.papiers)) expect(typeof v).toBe("number");
    for (const v of Object.values(e.jugement)) expect(typeof v).toBe("number");
  });
});
