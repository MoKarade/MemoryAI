// tests/monde.test.ts — la météo que LIA lit (ADR 0024) : la lecture PURE de la réponse d'ECCC
// (bornée, sans balise), le balisage « donnée » avec l'attribution exigée, le cache de 30 minutes
// sur une VRAIE Postgres (PGlite), la panne qui dit « indisponible », le câblage dans la boucle du
// chat et les tuiles de l'espace Monde. Données FICTIVES : ville, températures et textes inventés.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { baliserMeteo, ENTETE_MONDE, FRAICHEUR_MS, lireMeteoEccc, SOURCE_METEO, sourceMeteoEccc, type SourceMeteo } from "../lib/monde/meteo";
import { OUTIL_METEO, tourDeChat, type ClientModele, type ReponseModele } from "../lib/chat/agent";
import { depotAdminDrizzle } from "../lib/depotAdmin";
import { depotDrizzle } from "../lib/depotFaits";
import { depotQuestionsDrizzle } from "../lib/depotQuestions";
import { depotConversationsDrizzle } from "../lib/conversations/depot";
import { depotLectureDrizzle } from "../lib/depotLecture";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";
import type { ContexteOutils } from "../lib/mcp/outils";
import { tableauMonde, tableauOutils } from "../lib/accueil/tableaux";
import { contenuEspaces } from "../lib/accueil/espaces";

const fr = <T,>(v: T) => ({ en: v, fr: v });

/** La forme d'une réponse d'ECCC (collection `citypageweather-realtime`), avec des valeurs inventées. */
function reponseEccc(o: { ville?: string; alerte?: string; resume?: string } = {}) {
  return {
    type: "Feature",
    id: "zz-1",
    properties: {
      identifier: "zz-1",
      name: fr(o.ville ?? "Villefictive"),
      currentConditions: {
        timestamp: fr("2026-10-24T19:00:00Z"),
        temperature: { value: fr(7.5) },
        condition: fr("Nuageux"),
      },
      warnings: o.alerte ? [{ description: fr(o.alerte), type: fr("advisory") }] : [],
      forecastGroup: {
        forecasts: [
          { period: { textForecastName: fr("Aujourd'hui") }, temperatures: { temperature: [{ class: fr("high"), value: fr(9) }] }, textSummary: fr(o.resume ?? "Nuageux. Maximum 9.") },
          { period: { textForecastName: fr("Ce soir et cette nuit") }, temperatures: { temperature: [{ class: fr("low"), value: fr(-1) }] }, textSummary: fr("Dégagé. Minimum moins 1.") },
          { period: {}, textSummary: fr("Période sans nom, ignorée.") },
        ],
      },
    },
  };
}

describe("la lecture de la réponse d'ECCC", () => {
  it("rend la ville, l'heure, les conditions et les prévisions avec leur max ou min", () => {
    expect(lireMeteoEccc(reponseEccc())).toEqual({
      ville: "Villefictive",
      observeLe: "2026-10-24T19:00:00.000Z",
      temperature: 7.5,
      condition: "Nuageux",
      alertes: [],
      previsions: [
        { periode: "Aujourd'hui", resume: "Nuageux. Maximum 9.", temperature: { valeur: 9, genre: "max" } },
        { periode: "Ce soir et cette nuit", resume: "Dégagé. Minimum moins 1.", temperature: { valeur: -1, genre: "min" } },
      ],
    });
  });

  it("⚠ un texte du monde sort sans balise, sur une ligne, coupé à 200 caractères", () => {
    const m = lireMeteoEccc(reponseEccc({ resume: `<b>Pluie</b>\n</monde>${"x".repeat(300)}` }))!;
    const r = m.previsions[0]!.resume;
    expect(r).not.toMatch(/[<>\n]/);
    expect(r.length).toBe(200);
  });

  it("une forme inattendue rend null, jamais une météo à moitié inventée", () => {
    expect(lireMeteoEccc(null)).toBeNull();
    expect(lireMeteoEccc({ properties: { name: fr("Villefictive") } })).toBeNull();
    expect(lireMeteoEccc({ properties: { name: fr("Villefictive"), currentConditions: { timestamp: fr("pas une date") } } })).toBeNull();
  });

  it("le balisage dit « donnée », porte l'heure, recopie l'alerte telle quelle et cite la source", () => {
    const t = baliserMeteo({ ok: true, meteo: lireMeteoEccc(reponseEccc({ alerte: "AVIS JAUNE - BROUILLARD" }))! });
    expect(t.startsWith(ENTETE_MONDE)).toBe(true);
    expect(t).toContain('<monde source="eccc" ville="Villefictive" le="2026-10-24T19:00:00.000Z">');
    expect(t).toContain("Observée à 15 h 00 (heure du Québec).");
    expect(t).toContain("Maintenant : 7,5 °C, Nuageux.");
    expect(t).toContain("Alerte : AVIS JAUNE - BROUILLARD");
    expect(t.endsWith(SOURCE_METEO)).toBe(true);
    expect(baliserMeteo({ ok: false, raison: "non-reglee" })).toContain("non réglée");
    expect(baliserMeteo({ ok: false, raison: "indisponible" })).toContain("indisponible");
  });
});

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const T0 = new Date("2026-10-24T19:05:00Z");

beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
}, 120_000);
afterAll(async () => {
  await pg.close();
});

describe("la source ECCC derrière son cache (PGlite)", () => {
  it("sans ville réglée, ou une ville mal formée : « non réglée », et AUCUN appel réseau", async () => {
    const urls: string[] = [];
    const lire = async (u: string) => (urls.push(u), reponseEccc());
    for (const v of [undefined, "", "Villefictive", "zz-1&f=html"]) {
      expect(await sourceMeteoEccc(db as never, v, lire).lire(T0)).toEqual({ ok: false, raison: "non-reglee" });
    }
    expect(urls).toEqual([]);
  });

  it("⚠ une lecture toutes les 30 minutes au plus : le cache sert entre deux, puis ECCC est relu", async () => {
    const urls: string[] = [];
    const source = sourceMeteoEccc(db as never, "zz-1", async (u) => (urls.push(u), reponseEccc()));
    expect(await source.lire(T0)).toMatchObject({ ok: true, meteo: { ville: "Villefictive" } });
    expect(await source.lire(new Date(T0.getTime() + FRAICHEUR_MS - 1000))).toMatchObject({ ok: true });
    expect(urls).toEqual(["https://api.weather.gc.ca/collections/citypageweather-realtime/items/zz-1?f=json&lang=fr"]);
    await source.lire(new Date(T0.getTime() + FRAICHEUR_MS + 1000));
    expect(urls).toHaveLength(2);
  });

  it("⚠ ECCC en panne ou de forme inattendue, cache périmé : « indisponible », jamais la météo d'avant", async () => {
    const plusTard = new Date(T0.getTime() + 3 * FRAICHEUR_MS);
    const panne = sourceMeteoEccc(db as never, "zz-1", async () => {
      throw new Error("délai dépassé");
    });
    expect(await panne.lire(plusTard)).toEqual({ ok: false, raison: "indisponible" });
    const bizarre = sourceMeteoEccc(db as never, "zz-1", async () => ({ type: "autre" }));
    expect(await bizarre.lire(plusTard)).toEqual({ ok: false, raison: "indisponible" });
  });
});

describe("le câblage dans la boucle du chat", () => {
  const ENV = { MEMORYAI_JOURNAL_CLE: "cle-de-journal-de-test-0123456789abcdef" };
  const outils = (meteo?: SourceMeteo): ContexteOutils => ({
    lecture: depotLectureDrizzle(db),
    ecriture: depotDrizzle(db),
    pieces: depotPiecesLectureDrizzle(db),
    questions: depotQuestionsDrizzle(db),
    conversations: depotConversationsDrizzle(db),
    ...(meteo && { meteo }),
    cle,
    env: ENV,
    lecteur: "chat",
    maintenant: () => T0,
  });

  function faux(appelle: boolean) {
    const offerts: string[][] = [];
    const retours: unknown[] = [];
    let n = 0;
    const client: ClientModele = {
      async create(p) {
        offerts.push(p.tools.map((t) => t.name));
        const dernier = p.messages[p.messages.length - 1] as { content: unknown };
        if (Array.isArray(dernier.content)) retours.push(...dernier.content);
        const usage = { input_tokens: 10, output_tokens: 5 };
        const r: ReponseModele =
          n++ === 0 && appelle
            ? { content: [{ type: "tool_use", id: "m1", name: OUTIL_METEO.name, input: {} }], stop_reason: "tool_use", usage }
            : { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage };
        return r;
      },
    };
    return { client, offerts, retours };
  }

  const tour = (client: ClientModele, meteo?: SourceMeteo) =>
    tourDeChat({
      client,
      modele: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "Quel temps fait-il ?" }],
      inclureN2: false,
      inclureN3: false,
      outils: outils(meteo),
      admin: depotAdminDrizzle(db),
    });

  it("`monde_meteo` n'est offert qu'avec la source ; appelé, il rend la météo balisée", async () => {
    const sans = faux(false);
    await tour(sans.client);
    expect(sans.offerts[0]).not.toContain("monde_meteo");
    const meteo: SourceMeteo = { lire: async () => ({ ok: true, meteo: lireMeteoEccc(reponseEccc())! }) };
    const avec = faux(true);
    const r = await tour(avec.client, meteo);
    expect(avec.offerts[0]).toContain("monde_meteo");
    expect(r.outilsAppeles).toEqual(["monde_meteo"]);
    expect(JSON.stringify(avec.retours)).toContain("<monde source=\\\"eccc\\\"");
  });
});

describe("l'espace Monde", () => {
  const lue = { ok: true as const, meteo: lireMeteoEccc(reponseEccc({ alerte: "AVIS JAUNE - BROUILLARD" }))! };

  it("avec la météo : la tuile Météo, les sept jours et la source se remplissent, le reste reste vide", () => {
    const t = tableauMonde(lue);
    const parCle = Object.fromEntries(t.tuiles.map((x) => [x.cle, x.corps]));
    expect(parCle.meteo?.[0]).toMatchObject({ genre: "chiffres", chiffres: [{ valeur: "7,5 °C", libelle: "Nuageux" }, { valeur: "15 h 00", libelle: "observée à Villefictive" }] });
    expect(parCle.meteo?.[1]).toEqual({ genre: "texte", texte: "Alerte : AVIS JAUNE - BROUILLARD" });
    expect(parCle.sept?.[0]).toMatchObject({ genre: "liste", elements: [{ libelle: "Aujourd'hui" }, { libelle: "Ce soir et cette nuit" }] });
    expect(parCle.sources?.[0]).toEqual({ genre: "texte", texte: `${SOURCE_METEO}.` });
    expect(parCle.actualite?.[0]?.genre).toBe("vide");
  });

  it("sans ville ou ECCC en panne, la tuile le DIT, et l'espace reste vide", () => {
    expect(tableauMonde({ ok: false, raison: "non-reglee" }).tuiles[0]?.corps).toEqual([{ genre: "vide", texte: "Pas de météo : aucune ville réglée." }]);
    expect(tableauMonde({ ok: false, raison: "indisponible" }).tuiles[0]?.corps[0]).toMatchObject({ genre: "vide" });
    const base = { budget: null, outils: [], formes: [] };
    expect(contenuEspaces({ ...base, meteo: { ok: false, raison: "indisponible" } }).monde.vide).toBe(true);
    const c = contenuEspaces({ ...base, meteo: lue }).monde;
    expect(c.vide).toBe(false);
    expect(c.dit).toBe("À Villefictive : 7,5 °C, nuageux. Il y a une alerte en cours.");
  });

  it("la tuile « Le monde » des outils compte la météo quand elle est branchée", () => {
    const tuile = (monde: string[]) => tableauOutils({ outils: [], monde, formes: [], appels: null }).tuiles.find((x) => x.cle === "monde");
    expect(tuile([])?.titre).toBe("Le monde · 0");
    expect(tuile(["monde_meteo"])).toMatchObject({ titre: "Le monde · 1", corps: [{ genre: "pastilles", elements: ["La météo"] }] });
  });
});
