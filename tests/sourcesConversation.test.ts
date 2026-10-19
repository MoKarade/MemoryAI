// tests/sourcesConversation.test.ts — claude.ai et Claude Code consignent (ADR 0002, lot 10).
//
// La garde qui compte ici vient de la décision de Marc : Claude Code pousse AUTOMATIQUEMENT,
// donc personne ne relit avant l'envoi. Deux barrières, et chacune a ses cas :
//   1. le SCRIPT ne retient que les blocs `type: "text"` — les diffs et les fichiers lus ne
//      sortent jamais de la machine ;
//   2. le SERVEUR refuse un corps qui porte un résultat d'outil, où qu'il soit imbriqué.
//
// Et la source est imposée par l'APPELANT (le jeton, ou le MCP), jamais lue dans le corps :
// Claude Code ne peut pas se faire passer pour claude.ai, ni l'inverse.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotConversationsDrizzle } from "../lib/conversations/depot";
import { depotDrizzle } from "../lib/depotFaits";
import { depotLectureDrizzle } from "../lib/depotLecture";
import { depotQuestionsDrizzle } from "../lib/depotQuestions";
import {
  CLES_INTERDITES,
  MAX_MESSAGES_PAR_ENVOI,
  porteUnResultatDOutil,
  validerEntree,
} from "../lib/conversations/entree";
import { OUTILS, type ContexteOutils } from "../lib/mcp/outils";
import { decouperEnLots, extraireMessages } from "../scripts/pousser-session.mjs";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const T0 = new Date("2026-09-15T22:40:00Z");

const consigner = OUTILS.find((o) => o.name === "memoryai_consigner")!;

function ctx(): ContexteOutils {
  return {
    lecture: depotLectureDrizzle(db),
    ecriture: depotDrizzle(db),
    pieces: depotPiecesLectureDrizzle(db),
    questions: depotQuestionsDrizzle(db),
    conversations: depotConversationsDrizzle(db),
    cle,
    env: { MEMORYAI_JOURNAL_CLE: "cle-de-journal-de-test-0123456789abcdef" },
    lecteur: "claude-ai",
    maintenant: () => T0,
  };
}

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

describe("validerEntree — un résultat d'outil ne passe JAMAIS", () => {
  it("refuse une clé interdite au premier niveau", () => {
    for (const cle of CLES_INTERDITES) {
      const v = validerEntree({ source: "claude-code", messages: [], [cle]: "peu importe" });
      expect(v.ok, cle).toBe(false);
      if (!v.ok) expect(v.code).toBe("resultat_outil_interdit");
    }
  });

  it("la refuse AUSSI quand elle est IMBRIQUÉE — c'est la forme qu'un client mal réglé produit", () => {
    const corps = { source: "claude-code", messages: [{ role: "user", contenu: { tool_result: "diff entier" } }] };
    const v = validerEntree(corps);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("resultat_outil_interdit");
    expect(porteUnResultatDOutil(corps)).toBe("tool_result");
  });

  it("le refus passe AVANT le schéma : la raison dit le VRAI problème", () => {
    // Corps par ailleurs invalide (champ inconnu) ET porteur d'un diff : c'est le diff qui
    // doit être nommé, sinon on corrigerait le mauvais problème.
    const v = validerEntree({ source: "claude-code", messages: [], diff: "…", inconnu: 1 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("resultat_outil_interdit");
  });

  it("laisse passer une conversation ordinaire", () => {
    const v = validerEntree({
      source: "claude-code",
      messages: [
        { role: "user", contenu: "Corrige le plafond du contrat." },
        { role: "assistant", contenu: "C'est 8, pas 12 — je pousse le correctif." },
      ],
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.source).toBe("claude-code");
      expect(v.messages).toHaveLength(2);
    }
  });

  it("borne le lot, refuse un message vide, refuse une source inconnue", () => {
    const trop = { source: "claude-code", messages: Array.from({ length: MAX_MESSAGES_PAR_ENVOI + 1 }, () => ({ role: "user", contenu: "x" })) };
    expect((validerEntree(trop) as { code?: string }).code).toBe("lot_trop_grand");
    expect((validerEntree({ source: "claude-code", messages: [{ role: "user", contenu: "   " }] }) as { code?: string }).code).toBe("message_vide");
    expect((validerEntree({ source: "ailleurs", messages: [] }) as { code?: string }).code).toBe("source_inconnue");
  });

  it("la source IMPOSÉE écrase celle du corps : une source ne peut pas se faire passer pour l'autre", () => {
    const v = validerEntree({ source: "claude-code", messages: [{ role: "user", contenu: "Bonjour." }] }, "claude-ai");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.source).toBe("claude-ai");
  });
});

describe("memoryai_consigner — l'outil de claude.ai", () => {
  it("consigne, rend l'identifiant, et ne sert AUCUN fait", async () => {
    const r = await consigner.executer(
      { messages: [{ role: "user", contenu: "Mon bail finit en juin 2028." }, { role: "assistant", contenu: "Noté." }] },
      ctx(),
    );
    expect(r.usage).toBe("action");
    expect(r.faitsServis).toEqual([]);
    const id = /conversation_id : ([0-9a-f-]{36})/.exec(r.texte)?.[1];
    expect(id, "l'identifiant est rendu pour continuer la conversation").toBeTruthy();

    const d = depotConversationsDrizzle(db);
    const conv = await d.parId(id!);
    expect(conv?.source, "le MCP écrit TOUJOURS en claude-ai").toBe("claude-ai");
    expect(conv?.nbMessages).toBe(2);
  });

  it("continue la MÊME conversation quand on lui rend l'identifiant", async () => {
    const un = await consigner.executer({ messages: [{ role: "user", contenu: "Premier." }] }, ctx());
    const id = /conversation_id : ([0-9a-f-]{36})/.exec(un.texte)![1]!;
    await consigner.executer({ messages: [{ role: "assistant", contenu: "Deuxième." }], conversation_id: id }, ctx());
    const conv = await depotConversationsDrizzle(db).parId(id);
    expect(conv?.nbMessages).toBe(2);
  });

  it("refuse un résultat d'outil, et le DIT", async () => {
    const r = await consigner.executer({ messages: [{ role: "user", contenu: "x", tool_result: "diff" }] }, ctx());
    expect(r.texte).toMatch(/resultat_outil_interdit/);
  });

  it("le catalogue l'annonce, et il exige `messages`", () => {
    expect(OUTILS.map((o) => o.name)).toContain("memoryai_consigner");
    expect(consigner.inputSchema.required).toEqual(["messages"]);
  });
});

describe("le script de Claude Code — seul le TEXTE sort de la machine", () => {
  const transcription = [
    JSON.stringify({ type: "user", message: { role: "user", content: "Corrige le plafond." } }),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "C'est 8, pas 12." },
          { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/secret/clef.ts", new_string: "sk-ant-…" } },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "--- a/lib/x.ts\n+++ b/lib/x.ts" }] },
    }),
    "{ceci n'est pas du JSON}",
    JSON.stringify({ type: "system", subtype: "init" }),
  ].join("\n");

  it("ne retient que les blocs de texte, compte ce qu'il ignore, et survit à une ligne illisible", () => {
    const r = extraireMessages(transcription);
    expect(r.messages).toEqual([
      { role: "user", contenu: "Corrige le plafond." },
      { role: "assistant", contenu: "C'est 8, pas 12." },
    ]);
    expect(r.blocsIgnores, "le tool_use et le tool_result sont comptés, pas envoyés").toBe(2);
    expect(r.lignesIllisibles, "une transcription tronquée est le cas NORMAL").toBe(1);
  });

  it("aucun contenu de fichier ni de diff ne survit à l'extraction", () => {
    const tout = extraireMessages(transcription).messages.map((m) => m.contenu).join("\n");
    expect(tout).not.toContain("/secret/clef.ts");
    expect(tout).not.toContain("+++ b/lib/x.ts");
  });

  it("ce que le script produit est ACCEPTÉ par le serveur — les deux bouts se parlent", () => {
    const { messages } = extraireMessages(transcription);
    const v = validerEntree({ source: "claude-code", messages }, "claude-code");
    expect(v.ok, "le script ne doit pas produire ce que la route refuse").toBe(true);
  });

  it("découpe en lots bornés par ce que le serveur accepte", () => {
    const messages = Array.from({ length: 450 }, (_, i) => ({ role: "user", contenu: `m${i}` }));
    const lots = decouperEnLots(messages);
    expect(lots.map((l) => l.length)).toEqual([MAX_MESSAGES_PAR_ENVOI, MAX_MESSAGES_PAR_ENVOI, 50]);
  });
});
