// tests/conversations.test.ts — la mémoire des conversations (ADR 0002 §2 et §5.2).
//
// Dans l'ordre d'importance :
//   1. l'AAD scelle la POSITION : déplacer un message ou changer son rang casse la lecture ;
//   2. le scan de secrets tourne AVANT le chiffrement — et il compte ce qu'il a retiré ;
//   3. une conversation oubliée ne se remplit plus, ne s'affiche plus, ne compte plus ;
//   4. AUCUN chemin d'app n'atteint les conversations : ni le MCP, ni `POST /api/faits`. Ce
//      n'est pas une politique, c'est une propriété du graphe d'imports — vérifiée sur les
//      fichiers réels, parce qu'une frontière qui repose sur la vigilance n'en est pas une.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle, DechiffrementError } from "../lib/chiffrement";
import {
  aadMessage,
  depotConversationsDrizzle,
  NIVEAU_CONVERSATION,
  PLAFOND_NEON_OCTETS,
  SEUIL_ALERTE,
} from "../lib/conversations/depot";
import { MARQUE } from "../lib/conversations/secrets";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const T0 = new Date("2026-09-15T22:00:00Z");
const A = (...p: string[]) => p.join("");

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

describe("consigner et relire", () => {
  it("garde le texte INTÉGRAL, chiffré, et le rend dans l'ordre", async () => {
    const d = depotConversationsDrizzle(db);
    const id = await d.demarrer("memoryai", T0);
    await d.consigner(
      id,
      [
        { role: "user", contenu: "Quand finit mon bail de logement ?" },
        { role: "assistant", contenu: "Le 30 juin 2028, d'après ce que la mémoire porte." },
      ],
      cle,
      T0,
    );

    const [enBase] = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, id));
    expect(enBase!.contenu, "le contenu est scellé, pas en clair").not.toContain("bail");
    expect(enBase!.contenu.startsWith("v2:")).toBe(true);

    const lus = await d.messages(id, cle);
    expect(lus.map((m) => [m.index, m.role, m.contenu])).toEqual([
      [0, "user", "Quand finit mon bail de logement ?"],
      [1, "assistant", "Le 30 juin 2028, d'après ce que la mémoire porte."],
    ]);
  });

  it("les tours suivants s'AJOUTENT : les index continuent, ils ne repartent pas de zéro", async () => {
    const d = depotConversationsDrizzle(db);
    const id = await d.demarrer("memoryai", T0);
    await d.consigner(id, [{ role: "user", contenu: "Premier tour." }], cle, T0);
    await d.consigner(id, [{ role: "assistant", contenu: "Deuxième." }], cle, T0);
    const lus = await d.messages(id, cle);
    expect(lus.map((m) => m.index)).toEqual([0, 1]);
    const c = await d.parId(id);
    expect(c?.nbMessages).toBe(2);
  });

  it("l'AAD scelle la POSITION : un message lu au mauvais rang ne se déchiffre pas", async () => {
    const d = depotConversationsDrizzle(db);
    const id = await d.demarrer("memoryai", T0);
    await d.consigner(id, [{ role: "user", contenu: "Un secret de rien du tout." }], cle, T0);
    const [m] = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, id));

    const { dechiffrer } = await import("../lib/chiffrement");
    // Le bon AAD lit ; un index voisin, une autre conversation, une autre source : chacun casse.
    expect(dechiffrer(cle, m!.contenu, aadMessage(id, "memoryai", 0), NIVEAU_CONVERSATION)).toBe(
      "Un secret de rien du tout.",
    );
    for (const faux of [aadMessage(id, "memoryai", 1), aadMessage(id, "claude-code", 0), aadMessage("autre", "memoryai", 0)]) {
      expect(() => dechiffrer(cle, m!.contenu, faux, NIVEAU_CONVERSATION), faux).toThrow(DechiffrementError);
    }
  });
});

describe("le scan de secrets tourne AVANT le chiffrement", () => {
  it("un secret collé n'entre jamais en base, même chiffré — et il est compté", async () => {
    const d = depotConversationsDrizzle(db);
    const id = await d.demarrer("memoryai", T0);
    const secret = A("AKIA", "IOSFODNN7EXAMPLE");
    const r = await d.consigner(id, [{ role: "user", contenu: `Ma clé est ${secret}, tu peux tester ?` }], cle, T0);

    expect(r.secretsRetires).toBe(1);
    const lus = await d.messages(id, cle);
    expect(lus[0]!.contenu).toContain(MARQUE);
    expect(lus[0]!.contenu, "le secret ne survit pas au déchiffrement non plus").not.toContain(secret);
    expect(lus[0]!.secretsRetires).toBe(1);

    const c = await d.parId(id);
    expect(c?.secretsRetires, "le compte remonte sur la conversation").toBe(1);
  });

  it("les octets comptent le texte MASQUÉ, celui qui est réellement gardé", async () => {
    const d = depotConversationsDrizzle(db);
    const id = await d.demarrer("memoryai", T0);
    const texte = "Bonjour la mémoire.";
    await d.consigner(id, [{ role: "user", contenu: texte }], cle, T0);
    const c = await d.parId(id);
    expect(c?.octets).toBe(Buffer.byteLength(texte, "utf8"));
  });
});

describe("oublier — le même chemin qu'un fait", () => {
  it("une conversation oubliée ne se remplit plus, ne se lit plus, ne compte plus", async () => {
    const d = depotConversationsDrizzle(db);
    const id = await d.demarrer("memoryai", T0);
    await d.consigner(id, [{ role: "user", contenu: "À oublier." }], cle, T0);
    const avant = await d.mesure();

    expect(await d.oublier(id, T0)).toBe("ok");
    expect(await d.oublier(id, T0), "elle n'est plus vivante").toBe("introuvable");
    expect(await d.parId(id)).toBeNull();
    expect(await d.messages(id, cle)).toEqual([]);

    const suite = await d.consigner(id, [{ role: "user", contenu: "Reviens." }], cle, T0);
    expect(suite.ecrits, "une conversation oubliée ne revient pas par la porte de service").toBe(0);

    const apres = await d.mesure();
    expect(apres.nombre).toBe(avant.nombre - 1);
    expect((await d.liste(50)).map((c) => c.id)).not.toContain(id);
  });
});

describe("la mesure — c'est elle qui rendra la rétention décidable", () => {
  it("somme ce qui est vivant, et l'alerte se dérive du plafond, pas d'un nombre recopié", async () => {
    const m = await depotConversationsDrizzle(db).mesure();
    expect(m.octets).toBeGreaterThan(0);
    expect(m.partDuPlafond).toBeCloseTo(m.octets / PLAFOND_NEON_OCTETS, 12);
    expect(m.alerte).toBe(m.partDuPlafond >= SEUIL_ALERTE);
    // Aujourd'hui la base est vide à l'échelle du plafond : l'alerte doit être FAUSSE, sinon
    // elle crierait dès le premier jour et on prendrait l'habitude de l'ignorer.
    expect(m.alerte).toBe(false);
  });
});

describe("[L2] l'historique du chat — apercus", () => {
  it("rend les conversations d'UNE source, les plus récentes d'abord, titrées par le premier message de Marc", async () => {
    const d = depotConversationsDrizzle(db);
    const T1 = new Date("2026-09-24T10:00:00Z");
    const T2 = new Date("2026-09-24T11:00:00Z");
    const ancienne = await d.demarrer("memoryai", T1);
    await d.consigner(ancienne, [{ role: "user", contenu: "Quand expire mon passeport ?" }, { role: "assistant", contenu: "Le 17/03/2030." }], cle, T1);
    const recente = await d.demarrer("memoryai", T2);
    await d.consigner(recente, [{ role: "user", contenu: "x".repeat(200) }], cle, T2);
    // Une session Claude Code consignée n'est PAS une conversation du chat.
    const code = await d.demarrer("claude-code", T2);
    await d.consigner(code, [{ role: "user", contenu: "session de code" }], cle, T2);

    const l = await d.apercus("memoryai", 50, cle);
    const ids = l.map((c) => c.id);
    expect(ids).not.toContain(code);
    expect(ids.indexOf(recente)).toBeLessThan(ids.indexOf(ancienne));
    const a = l.find((c) => c.id === ancienne)!;
    expect(a.titre).toBe("Quand expire mon passeport ?");
    expect(a.nbMessages).toBe(2);
    // Tronqué, et le DIT par son dernier caractère.
    const r = l.find((c) => c.id === recente)!;
    expect(r.titre!.length).toBe(80);
    expect(r.titre!.endsWith("…")).toBe(true);
  });

  it("une conversation OUBLIÉE sort de l'historique", async () => {
    const d = depotConversationsDrizzle(db);
    const id = await d.demarrer("memoryai", T0);
    await d.consigner(id, [{ role: "user", contenu: "à oublier" }], cle, T0);
    expect((await d.apercus("memoryai", 100, cle)).map((c) => c.id)).toContain(id);
    await d.oublier(id, T0);
    expect((await d.apercus("memoryai", 100, cle)).map((c) => c.id)).not.toContain(id);
  });

  it("un premier message ILLISIBLE laisse la conversation dans la liste, sans titre", async () => {
    const d = depotConversationsDrizzle(db);
    const id = await d.demarrer("memoryai", T0);
    await d.consigner(id, [{ role: "user", contenu: "lisible" }], cle, T0);
    const autre = deriverCle(randomBytes(32).toString("base64"));
    const l = await d.apercus("memoryai", 100, autre);
    const c = l.find((x) => x.id === id);
    expect(c, "elle reste listée").toBeTruthy();
    expect(c!.titre).toBeNull();
  });
});

describe("la frontière — aucune app n'atteint les conversations", () => {
  const fichiers = execSync("git ls-files --cached --others --exclude-standard lib app", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  /**
   * Ce qui a le DROIT de lire les conversations, exprimé en RÈGLE et non en liste : le module
   * lui-même, sa page, et le chat qui les consigne. Une liste écrite à la main pourrit au
   * premier fichier ajouté — et on l'y ajoute par réflexe, ce qui vide la garde de son sens.
   * Une règle, elle, oblige à se demander si le nouveau fichier a sa place DANS le périmètre.
   */
  const autorise = (f: string) =>
    f.startsWith("lib/conversations/") ||
    f.startsWith("app/conversations/") ||
    f === "app/api/chat/route.ts" ||
    f === "app/api/conversations/route.ts" ||
    // Le MCP y ÉCRIT (`memoryai_consigner`, lot 10) — jamais il n'y lit : son contexte le
    // reçoit en `Pick<…, "demarrer" | "consigner" | "parId">`, et le cas suivant le prouve.
    // ⚠️ `app/api/mcp/route.ts` n'est que le CÂBLAGE : il construit le contexte et passe le
    // dépôt, que le type restreint aussitôt. C'est pour ça que la garantie de ce lot n'est
    // PAS cette liste d'imports — elle s'allonge à chaque point de câblage — mais le `Pick`,
    // vérifié structurellement juste en dessous.
    f === "lib/mcp/outils.ts" ||
    f === "app/api/mcp/route.ts" ||
    // L'APPRENTISSAGE (lot 16). Il LIT les conversations — c'est son travail — et rien n'en
    // sort : il en tire des faits, qui passent par `validerFait` comme tout le reste, et la
    // conversation elle-même ne quitte jamais son module. Ce que cette garde protège est
    // « aucune APP n'atteint les conversations » ; l'horloge de l'apprentissage n'est pas une
    // app (aucun jeton d'app, aucun périmètre, elle ne sert que des compteurs), pas plus que
    // le chat juste au-dessus. ⚠️ Ces deux lignes se sont ajoutées parce que le test a ROUGI :
    // c'est le geste que sa propre consigne demande — se demander si le fichier a sa place
    // DANS le périmètre, et l'écrire —, pas un élargissement de motif pour faire passer.
    f === "lib/apprentissage.ts" ||
    f === "app/api/cron/apprentissage/route.ts" ||
    // **RÉGLER** (L26a, 18/09). Cette ligne s'est ajoutée parce que le test a ROUGI, et le
    // geste que demande sa consigne est de se demander si le fichier a sa place DANS le
    // périmètre — pas d'élargir un motif pour faire passer. Il l'a, pour trois raisons :
    // c'est la MÊME surface privée que `app/conversations/` déjà autorisée ci-dessus (la page
    // de Marc, derrière `requireSession()`, aucun jeton d'app, aucun périmètre) ; elle n'en
    // lit qu'un **COMPTE** (`mesure().nombre`), jamais un message ni un résumé ; et
    // `L26b` y déplacera le contenu de `app/conversations/` lui-même, donc le préfixe
    // rejoint le périmètre par construction plutôt qu'une ligne à la fois.
    // ⚠️ Ce que cette liste NE garantit pas, et c'est écrit plus haut : la protection contre
    // une APP reste le `Pick<…>` vérifié structurellement, pas cette énumération.
    f.startsWith("app/regler/") ||
    // **L'HISTORIQUE DU CHAT** (L2, ADR 0011, 24/09). Ajoutées parce que le test a ROUGI, et
    // la question posée par sa consigne a une réponse : ces deux fichiers SONT le chat de
    // Marc — la page de la conversation (`/chat` ; elle était l'accueil de L26a à MemoryAI#74)
    // et ses actions serveur —,
    // derrière `requireSession()`, sans aucun jeton d'app ni périmètre. Ils LISENT, eux, et
    // c'est le but : un titre par conversation pour la liste, les messages d'UNE conversation
    // du chat (`source === "memoryai"`) quand Marc la rouvre. Rien n'en sort vers une app ;
    // la garantie contre une app reste le `Pick<…>` du cas suivant.
    f === "app/chat/page.tsx" ||
    f === "app/chat/actions.ts";

  it("le scan trouve bien des fichiers, et la règle ne laisse pas tout passer — anti-vacuité", () => {
    expect(fichiers.length).toBeGreaterThan(20);
    expect(fichiers).toContain("lib/conversations/depot.ts");
    // Sans ce contrôle, une règle trop large (`() => true`) rendrait le cas suivant vacueux.
    expect(fichiers.filter((f) => !autorise(f)).length).toBeGreaterThan(20);
  });

  it("ni le MCP, ni le contrat d'écriture, ni la lecture des faits n'importent le module", () => {
    const interdits = fichiers.filter((f) => !autorise(f));
    for (const f of interdits) {
      const src = readFileSync(f, "utf8");
      expect(
        /from\s+["'][^"']*conversations\/depot["']/.test(src),
        `${f} importe le dépôt des conversations : une conversation ne sort vers aucune app`,
      ).toBe(false);
    }
  });

  it("un SEUL outil du catalogue parle de conversation, et il ÉCRIT", async () => {
    // ⚠️ Ce cas a d'abord scanné le SOURCE du fichier, et il rougissait sur `usage:
    // "conversation"` — le type d'usage du journal d'accès, qui n'a rien à voir. Un scan de
    // texte matche la prose ET les homonymes : ce qui compte est le catalogue PUBLIC, celui
    // que claude.ai reçoit à `tools/list`. On le dérive donc de `OUTILS`.
    const { OUTILS } = await import("../lib/mcp/outils");
    expect(OUTILS.length, "anti-vacuité : le catalogue n'est pas vide").toBeGreaterThanOrEqual(7);
    const parlants = OUTILS.filter((o) => /conversation/i.test(`${o.name} ${o.description} ${JSON.stringify(o.inputSchema)}`));
    expect(parlants.map((o) => o.name)).toEqual(["memoryai_consigner"]);
  });

  it("le MCP ne peut pas LIRE une conversation : c'est le TYPE qui l'interdit, pas une consigne", () => {
    // La garantie est structurelle. Si `ContexteOutils.conversations` redevenait le dépôt
    // ENTIER, un outil pourrait rendre le contenu déchiffré d'une conversation — et aucun
    // scan de texte ne l'attraperait. On lit donc la déclaration elle-même.
    const src = readFileSync("lib/mcp/outils.ts", "utf8");
    expect(src, "anti-vacuité : le champ existe bien").toMatch(/conversations:\s*Pick<DepotConversations,/);
    const pick = /conversations:\s*Pick<DepotConversations,\s*([^>]+)>/.exec(src)?.[1] ?? "";
    expect(pick).not.toMatch(/"messages"/);
    for (const m of ["demarrer", "consigner", "parId"]) expect(pick).toContain(`"${m}"`);
  });
});
