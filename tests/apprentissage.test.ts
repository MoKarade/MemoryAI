// tests/apprentissage.test.ts — la mémoire apprend TOUTE SEULE, et elle dit pourquoi elle s'arrête (lot 16).
//
// Ce que ces cas défendent, dans l'ordre :
//   1. le producteur de questions ne voit AUCUNE valeur — c'est ce qui le rend sûr par
//      construction, et c'est structurel, pas une précaution qu'on applique « en général » ;
//   2. une passe qui ne fait rien DIT pourquoi : « rien à lire » et « budget épuisé »
//      n'appellent pas le même geste, et les confondre est exactement la panne que DriveAI a
//      payée le matin du 16/09 (une étape qui sortait sans écrire une ligne) ;
//   3. le budget de l'apprentissage est le SIEN — une passe qui dévore la journée ne doit pas
//      fermer la bouche de Marc, et réciproquement ;
//   4. une file de questions déjà pleine ne déclenche AUCUN appel : payer pour faire
//      disparaître une question que Marc n'a pas lue est le contraire du but.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import type { Conversation } from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import type { ClientModele, ReponseModele } from "../lib/chat/agent";
import { PlafondApprentissageError } from "../lib/conversations/extraction";
import { PLAFONDS_DEFAUT_USD_PAR_JOUR } from "../lib/coutChat";
import { comptesParPredicatValides, depotAdminDrizzle } from "../lib/depotAdmin";
import { depotDrizzle } from "../lib/depotFaits";
import { depotQuestionsDrizzle } from "../lib/depotQuestions";
import { depotConversationsDrizzle } from "../lib/conversations/depot";
import { MAX_OUVERTES, validerQuestion } from "../lib/questions";
import { vocabulaire } from "../lib/vocabulaire";
import {
  apprendreDeLaConversation,
  conversationsAExtraire,
  FINS_PASSE,
  MAX_CONVERSATIONS_PAR_PASSE,
  meriteUnePasse,
  MOTIFS_FIN_PASSE,
  passeApprentissage,
  passeVide,
  SEUIL_MESSAGES_NON_EXTRAITS,
} from "../lib/apprentissage";
import {
  etatPourPrompt,
  lireQuestions,
  MAX_QUESTIONS_PROPOSEES,
  produireDesQuestions,
  PROMPT_QUESTIONS,
} from "../lib/questions/producteur";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const T0 = new Date("2026-09-16T14:00:00Z");

/** Un faux modèle qui rend ce qu'on lui donne, et COMPTE ses appels — c'est le compteur qui
 *  prouve « aucun appel », jamais l'absence de résultat (un appel raté rendrait 0 aussi). */
function faussaire(texte: string, usage: Record<string, number> = { input_tokens: 100, output_tokens: 50 }) {
  const vus: { system: string; messages: unknown[] }[] = [];
  const client: ClientModele = {
    async create(p) {
      vus.push({ system: p.system, messages: p.messages });
      return { content: [{ type: "text", text: texte }], stop_reason: "end_turn", usage } as ReponseModele;
    },
  };
  return { client, vus };
}

const conv = (o: Partial<Conversation> = {}): Conversation =>
  ({
    id: o.id ?? "c1",
    source: "memoryai",
    titre: null,
    debutLe: o.debutLe ?? T0,
    finLe: o.finLe ?? T0,
    nbMessages: o.nbMessages ?? 10,
    octets: 0,
    secretsRetires: 0,
    extraiteJusqua: o.extraiteJusqua ?? null,
    supprimeLe: o.supprimeLe ?? null,
  }) as Conversation;

/** Un jour NEUF par cas : les compteurs de dépense sont partagés par la base du fichier, et
 *  deux cas qui visent le même jour se marchent dessus (piège vécu sur `extraction.test.ts`). */
let n = 0;
const jourNeuf = () => new Date(T0.getTime() + ++n * 24 * 3600 * 1000);

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
});

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.exec("DELETE FROM questions");
});

describe("qui mérite une passe — un RANG, jamais un drapeau", () => {
  it("une conversation qui CONTINUE redevient extractible", () => {
    // 10 messages, 4 lus : les 6 suivants valent une passe. C'est ce qui rend l'appel après un
    // tour de chat sûr — un booléen « déjà extraite » la figerait à sa première lecture.
    expect(meriteUnePasse(conv({ nbMessages: 10, extraiteJusqua: 4 }))).toBe(true);
    expect(meriteUnePasse(conv({ nbMessages: 10, extraiteJusqua: 8 }))).toBe(false);
    expect(meriteUnePasse(conv({ nbMessages: SEUIL_MESSAGES_NON_EXTRAITS, extraiteJusqua: null }))).toBe(true);
    expect(meriteUnePasse(conv({ nbMessages: SEUIL_MESSAGES_NON_EXTRAITS - 1, extraiteJusqua: null }))).toBe(false);
  });

  it("une conversation OUBLIÉE ne se relit jamais, quel que soit son retard", () => {
    expect(meriteUnePasse(conv({ nbMessages: 500, extraiteJusqua: null, supprimeLe: T0 }))).toBe(false);
  });

  it("les plus RÉCENTES d'abord, et au plus la borne dure", () => {
    const toutes = Array.from({ length: MAX_CONVERSATIONS_PAR_PASSE + 5 }, (_, i) =>
      conv({ id: `c${i}`, finLe: new Date(T0.getTime() + i * 60_000) }),
    );
    const choisies = conversationsAExtraire(toutes);
    expect(choisies).toHaveLength(MAX_CONVERSATIONS_PAR_PASSE);
    expect(choisies[0]!.id).toBe(`c${toutes.length - 1}`);
  });
});

describe("le motif de fin — la leçon du 16/09", () => {
  it("CHAQUE fin a son motif, et deux fins ne disent jamais la même chose", () => {
    const motifs = FINS_PASSE.map((f) => MOTIFS_FIN_PASSE[f]);
    expect(motifs.every((m) => typeof m === "string" && m.length > 0)).toBe(true);
    expect(new Set(motifs).size).toBe(FINS_PASSE.length);
  });

  it("une passe vide porte son motif, jamais un objet muet", () => {
    expect(passeVide("budget")).toEqual({ conversations: 0, faitsProposes: 0, questionsPosees: 0, coutUsd: 0, fin: "budget" });
  });
});

describe("etatPourPrompt — AUCUNE valeur ne part au modèle", () => {
  it("chaque ligne est un prédicat du vocabulaire et un COMPTE, rien d'autre", () => {
    // La garde centrale de ce lot. Elle est STRUCTURELLE : la fonction ne reçoit que des
    // nombres, donc elle ne PEUT pas fuiter une valeur — ce cas prouve que sa sortie n'en
    // porte pas non plus par un autre chemin (une description, un exemple).
    const predicats = new Set(vocabulaire().map((p) => p.predicat));
    const lignes = etatPourPrompt({ "emploi.employeur": 3 }).split("\n").slice(1);
    expect(lignes.length).toBeGreaterThan(20);
    for (const l of lignes) {
      const m = /^- ([a-z0-9_.]+) : (\d+) fait\(s\) — /.exec(l);
      expect(m, l).not.toBeNull();
      expect(predicats.has(m![1]!), m![1]).toBe(true);
    }
    expect(etatPourPrompt({ "emploi.employeur": 3 })).toContain("- emploi.employeur : 3 fait(s)");
  });

  it("un prédicat sans aucun fait vaut 0, jamais l'absence", () => {
    // « 0 fait » EST l'information qu'on veut : c'est le trou que la question doit combler.
    expect(etatPourPrompt({})).toContain(" : 0 fait(s)");
  });

  it("le prompt interdit ce que la frontière interdit", () => {
    expect(PROMPT_QUESTIONS).toMatch(/montant/i);
    expect(PROMPT_QUESTIONS).toMatch(/adresse/i);
    expect(PROMPT_QUESTIONS).toMatch(/numéro d'identité/i);
  });
});

describe("lireQuestions — tolérante sur la forme, stricte sur le fond", () => {
  const json = '{"questions":[{"question":"Quel est ton employeur ?","predicat_vise":"emploi.employeur","motif":"aucun employeur"}]}';

  it("accepte un JSON entouré de texte ou d'un bloc de code", () => {
    for (const brut of [json, "```json\n" + json + "\n```", "Voici :\n" + json]) {
      const r = lireQuestions(brut);
      expect(r.ok, brut.slice(0, 20)).toBe(true);
      if (r.ok) expect(r.questions).toHaveLength(1);
    }
  });

  it("NOMME le refus plutôt que de rendre une liste vide", () => {
    const cas: [string, RegExp][] = [
      ["Je n'ai pas de question.", /aucun objet JSON/],
      ["{pas du json}", /illisible/],
      ['{"questions":[{"question":"a ?","predicat_vise":"x","motif":"m","extra":1}]}', /./],
    ];
    for (const [brut, attendu] of cas) {
      const r = lireQuestions(brut);
      expect(r.ok, brut.slice(0, 20)).toBe(false);
      if (!r.ok) expect(r.raison).toMatch(attendu);
    }
  });

  it("refuse plus de questions que la file ne peut en tenir", () => {
    const trop = {
      questions: Array.from({ length: MAX_QUESTIONS_PROPOSEES + 1 }, (_, i) => ({
        question: `q${i} ?`,
        predicat_vise: "emploi.employeur",
        motif: "m",
      })),
    };
    expect(lireQuestions(JSON.stringify(trop)).ok).toBe(false);
  });
});

describe("produireDesQuestions — la garde qui décide est celle que l'écriture consulte", () => {
  const bonneReponse = JSON.stringify({
    questions: [
      { question: "Quel est ton employeur actuel ?", predicat_vise: "emploi.employeur", motif: "aucun employeur enregistré" },
      { question: "As-tu des allergies ?", predicat_vise: "inconnu.predicat", motif: "prédicat qui n'existe pas" },
    ],
  });

  const produire = (client: ClientModele, quand: Date) =>
    produireDesQuestions({
      client,
      modele: "claude-sonnet-5",
      admin: depotAdminDrizzle(db),
      questions: depotQuestionsDrizzle(db),
      comptesParPredicat: {},
      maintenant: () => quand,
    });

  it("ce qui ne passe pas `validerQuestion` ne se pose pas — et l'origine vient de l'APPELANT", async () => {
    const { client, vus } = faussaire(bonneReponse);
    const r = await produire(client, jourNeuf());
    expect(vus).toHaveLength(1);
    expect(r.proposees).toBe(2);
    expect(r.posees).toBe(1); // le prédicat inconnu est refusé par la porte, pas par le prompt
    const [q] = await depotQuestionsDrizzle(db).ouvertes(10);
    expect(q!.origine).toBe("regle");
    expect(q!.predicatVise).toBe("emploi.employeur");
  });

  it("une file DÉJÀ PLEINE ne déclenche AUCUN appel", async () => {
    // Payer un appel pour faire disparaître une question que Marc n'a pas encore lue est le
    // contraire du but. Le compteur d'appels le prouve — un `posees: 0` ne prouverait rien.
    const depot = depotQuestionsDrizzle(db);
    for (let i = 0; i < MAX_OUVERTES; i++) {
      const v = validerQuestion(
        { question: `Question ${i} ?`, predicat_vise: "emploi.employeur", motif: "m" },
        "regle",
      );
      expect(v.ok).toBe(true);
      if (v.ok) await depot.poser(v, T0);
    }
    const { client, vus } = faussaire(bonneReponse);
    const r = await produire(client, jourNeuf());
    expect(vus).toHaveLength(0);
    expect(r).toEqual({ proposees: 0, posees: 0, coutUsd: 0, refusDeForme: null });
  });

  it("l'appel est COMPTÉ même quand la réponse est inutilisable", async () => {
    const jour = jourNeuf();
    const { client } = faussaire("Je préfère ne pas répondre.");
    const r = await produire(client, jour);
    expect(r.refusDeForme).toMatch(/aucun objet JSON/);
    expect(r.coutUsd).toBeGreaterThan(0);
    const admin = depotAdminDrizzle(db);
    const j = jour.toLocaleDateString("en-CA", { timeZone: "America/Montreal" });
    expect(await admin.depenseDuJourUsd(j, "apprentissage")).toBeCloseTo(r.coutUsd, 10);
  });

  it("le plafond coupe AVANT l'appel, et il est celui de l'APPRENTISSAGE", async () => {
    const jour = jourNeuf();
    const j = jour.toLocaleDateString("en-CA", { timeZone: "America/Montreal" });
    await depotAdminDrizzle(db).enregistrerDepense({
      jour: j,
      poste: "apprentissage",
      modele: "claude-sonnet-5",
      entree: 1,
      sortie: 1,
      coutUsd: PLAFONDS_DEFAUT_USD_PAR_JOUR.apprentissage,
    });
    const { client, vus } = faussaire(bonneReponse);
    await expect(produire(client, jour)).rejects.toBeInstanceOf(PlafondApprentissageError);
    expect(vus).toHaveLength(0);
  });

  it("le budget du CHAT n'éteint pas l'apprentissage", async () => {
    // Deux postes, deux plafonds : une soirée de chat ne doit pas rendre la mémoire aveugle,
    // et une passe d'apprentissage ne doit pas fermer la bouche de Marc.
    const jour = jourNeuf();
    const j = jour.toLocaleDateString("en-CA", { timeZone: "America/Montreal" });
    await depotAdminDrizzle(db).enregistrerDepense({
      jour: j,
      poste: "chat",
      modele: "claude-sonnet-5",
      entree: 1,
      sortie: 1,
      coutUsd: PLAFONDS_DEFAUT_USD_PAR_JOUR.chat * 2,
    });
    const { client, vus } = faussaire(bonneReponse);
    const r = await produire(client, jour);
    expect(vus).toHaveLength(1);
    expect(r.posees).toBe(1);
  });
});

describe("passeApprentissage — elle dit toujours pourquoi elle s'arrête", () => {
  const passe = (client: ClientModele, quand: Date) =>
    passeApprentissage({
      client,
      modele: "claude-sonnet-5",
      cle,
      conversations: depotConversationsDrizzle(db),
      ecriture: depotDrizzle(db),
      admin: depotAdminDrizzle(db),
      questions: depotQuestionsDrizzle(db),
      // Ces cas portent sur les MOTIFS DE FIN de la passe, pas sur les contradictions : une
      // liste vide les neutralise sans rien masquer. Le comportement des contradictions —
      // détection, plafond, gratuité hors budget — vit dans `tests/contradictions.test.ts`,
      // avec ses mutations.
      faitsEnConflit: async () => [],
      // Ces cas portent sur le producteur PAR MODÈLE : les trous (gratuits, `tests/combler.test.ts`)
      // rempliraient la file avant lui et le compteur d'appels ne prouverait plus rien.
      comblerLesTrous: false,
      maintenant: () => quand,
      comptesParPredicat: () => comptesParPredicatValides(db),
    });

  it("aucune conversation neuve ⇒ « rien-a-faire », et les questions se posent quand même", async () => {
    // Une passe sans conversation n'est pas une passe inutile : ce qui manque depuis des
    // semaines mérite toujours d'être demandé.
    const { client, vus } = faussaire(
      JSON.stringify({
        questions: [{ question: "Quel est ton employeur ?", predicat_vise: "emploi.employeur", motif: "vide" }],
      }),
    );
    const r = await passe(client, jourNeuf());
    expect(r.conversations).toBe(0);
    expect(r.questionsPosees).toBe(1);
    expect(r.fin).toBe("termine"); // des questions ont été posées : ce n'est plus « rien à faire »
    expect(vus).toHaveLength(1);
  });

  it("budget épuisé ⇒ « budget », AUCUN appel, et le motif envoie sur le bon geste", async () => {
    const jour = jourNeuf();
    const j = jour.toLocaleDateString("en-CA", { timeZone: "America/Montreal" });
    await depotAdminDrizzle(db).enregistrerDepense({
      jour: j,
      poste: "apprentissage",
      modele: "claude-sonnet-5",
      entree: 1,
      sortie: 1,
      coutUsd: PLAFONDS_DEFAUT_USD_PAR_JOUR.apprentissage,
    });
    const { client, vus } = faussaire("{}");
    const r = await passe(client, jour);
    expect(r.fin).toBe("budget");
    expect(vus).toHaveLength(0);
    expect(MOTIFS_FIN_PASSE[r.fin]).toMatch(/demain/);
  });

  it("une conversation neuve est LUE, puis marquée — jamais relue à la passe suivante", async () => {
    const depot = depotConversationsDrizzle(db);
    const id = await depot.demarrer("memoryai", T0);
    await depot.consigner(
      id,
      Array.from({ length: SEUIL_MESSAGES_NON_EXTRAITS }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        contenu: `Message ${i}`,
      })),
      cle,
      T0,
    );
    const jour = jourNeuf();
    const { client, vus } = faussaire(
      JSON.stringify({ faits: [{ predicat: "gout.cuisine", valeur: "Cuisine thaïe", valeur_type: "texte" }] }),
    );
    const r1 = await passe(client, jour);
    expect(r1.conversations).toBe(1);
    expect(r1.faitsProposes).toBe(1);
    const apres = await depot.parId(id);
    expect(apres!.extraiteJusqua).toBe(SEUIL_MESSAGES_NON_EXTRAITS);

    // Deuxième passe : plus rien de neuf, et le compteur d'appels le prouve.
    const suite = faussaire("{}");
    const r2 = await passe(suite.client, jour);
    expect(r2.conversations).toBe(0);
    // Un seul appel : celui des questions. L'extraction, elle, n'a pas eu lieu.
    expect(suite.vus).toHaveLength(1);
    expect(vus.length).toBeGreaterThan(0);
  });
});

describe("apprendreDeLaConversation — le déclencheur du chat lit UNE conversation", () => {
  const apprendre = (client: ClientModele, conversationId: string, quand: Date) =>
    apprendreDeLaConversation({
      client,
      modele: "claude-sonnet-5",
      conversationId,
      cle,
      conversations: depotConversationsDrizzle(db),
      ecriture: depotDrizzle(db),
      admin: depotAdminDrizzle(db),
      maintenant: () => quand,
    });

  it("sous le seuil : rend `null` et n'appelle PAS le modèle", async () => {
    // « pas assez de neuf » et « ça a tourné et n'a rien trouvé » sont deux choses : le `null`
    // les distingue, le compteur d'appels le prouve.
    const depot = depotConversationsDrizzle(db);
    const id = await depot.demarrer("memoryai", T0);
    await depot.consigner(id, [{ role: "user", contenu: "Salut" }], cle, T0);
    const { client, vus } = faussaire("{}");
    expect(await apprendre(client, id, jourNeuf())).toBeNull();
    expect(vus).toHaveLength(0);
  });

  it("une conversation inconnue rend `null` plutôt que de lever", async () => {
    const { client, vus } = faussaire("{}");
    expect(await apprendre(client, randomUUID(), jourNeuf())).toBeNull();
    expect(vus).toHaveLength(0);
  });

  it("au-dessus du seuil : lit, propose, et marque le rang", async () => {
    const depot = depotConversationsDrizzle(db);
    const id = await depot.demarrer("memoryai", T0);
    await depot.consigner(
      id,
      Array.from({ length: SEUIL_MESSAGES_NON_EXTRAITS }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        contenu: `Message ${i}`,
      })),
      cle,
      T0,
    );
    const { client, vus } = faussaire(
      JSON.stringify({ faits: [{ predicat: "gout.cuisine", valeur: "Ramen", valeur_type: "texte" }] }),
    );
    const r = await apprendre(client, id, jourNeuf());
    expect(vus).toHaveLength(1);
    expect(r).not.toBeNull();
    expect(r!.faitsProposes).toBe(1);
    expect((await depot.parId(id))!.extraiteJusqua).toBe(SEUIL_MESSAGES_NON_EXTRAITS);
  });
});
