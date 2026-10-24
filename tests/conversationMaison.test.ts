// tests/conversationMaison.test.ts — « Parler » dans la maison de LIA (maquette v5, écart A7) : le fil
// et ses transitions, échec fermé, et ce que le panneau rend. Données FICTIVES.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  LONGUEUR_MAX_QUESTION,
  MESSAGE_INDISPONIBLE,
  SUGGESTIONS,
  echouer,
  enAttente,
  poser,
  questionPrete,
  repondre,
} from "@/lib/accueil/conversation";
import { ConversationMaison } from "@/components/ConversationMaison";

vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...reste }: { href: string; children?: unknown }) => ce("a", { href, ...reste }, children as never) };
});
vi.mock("@mokarade/lia-ui/blocs", () => ({ rendreBlocs: () => undefined }));

describe("le fil de « Parler »", () => {
  it("une question part nette, ni vide ni trop longue", () => {
    expect(questionPrete("  Que sais-tu ?  ")).toBe("Que sais-tu ?");
    expect(questionPrete("   ")).toBeNull();
    expect(questionPrete("a".repeat(LONGUEUR_MAX_QUESTION))).not.toBeNull();
    expect(questionPrete("a".repeat(LONGUEUR_MAX_QUESTION + 1))).toBeNull();
  });

  it("même plafond que la route : au-delà, elle refuserait", () => {
    expect(readFileSync("lib/lia/ask.ts", "utf8")).toContain(`const LONGUEUR_MAX_QUESTION = ${LONGUEUR_MAX_QUESTION};`);
  });

  it("poser, puis répondre : la réponse va à SA question", () => {
    let fil = poser([], "q1", "Bonjour ?");
    expect(enAttente(fil)).toBe(true);
    fil = repondre(fil, "q1", { text: "Bonjour.", blocks: [{ type: "carte" }] });
    expect(enAttente(fil)).toBe(false);
    expect(fil).toEqual([{ id: "q1", question: "Bonjour ?", etat: "repondu", texte: "Bonjour.", blocs: [{ type: "carte" }] }]);
  });

  it("échec fermé : « indisponible », jamais une réponse inventée", () => {
    const fil = echouer(poser([], "q1", "Bonjour ?"), "q1");
    expect(fil[0]).toEqual({ id: "q1", question: "Bonjour ?", etat: "echec", texte: MESSAGE_INDISPONIBLE });
  });

  it("une réponse tardive ne réécrit pas un tour déjà fini", () => {
    const fil = echouer(poser([], "q1", "Bonjour ?"), "q1");
    expect(repondre(fil, "q1", { text: "Trop tard." })[0]?.etat).toBe("echec");
  });

  it("huit suggestions, chacune une vraie question", () => {
    expect(SUGGESTIONS).toHaveLength(8);
    for (const s of SUGGESTIONS) expect(s.question.trim().length).toBeGreaterThan(5);
    // Pas les suggestions FICTIVES de la maquette (Julie, la voiture, l'épicerie).
    expect(SUGGESTIONS.map((s) => s.question).join(" ")).not.toMatch(/Julie|voiture|batch/i);
  });
});

describe("le panneau « Parler »", () => {
  const rendre = (fil: Parameters<typeof ConversationMaison>[0]["fil"]) => renderToStaticMarkup(createElement(ConversationMaison, { fil, demander: () => undefined }));

  it("vide : le mot d'accueil, les huit suggestions, la saisie et la conversation complète", () => {
    const html = rendre([]);
    expect(html).toContain("Pose-moi une question. Je choisis la forme de ma réponse.");
    expect(html.match(/<button type="button" aria-label="/g)).toHaveLength(8);
    expect(html).toContain('aria-label="Message à LIA"');
    expect(html).toContain('class="champ"');
    expect(html).toContain('href="/chat"');
  });

  it("en attente : elle réfléchit, et on ne peut pas reposer par-dessus", () => {
    const html = rendre(poser([], "q1", "Bonjour ?"));
    expect(html).toContain("LIA réfléchit");
    expect(html).not.toContain("Pose-moi une question");
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(9);
  });

  it("le texte du modèle est échappé, jamais du HTML", () => {
    const html = rendre(repondre(poser([], "q1", "<b>?</b>"), "q1", { text: "<img src=x onerror=alert(1)>" }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("la maison le monte", () => {
  it("le fil part par la même route que la bulle de LIA", () => {
    const accueil = readFileSync("app/AccueilClient.tsx", "utf8");
    expect(accueil).toMatch(/demanderLia\(question, controle\.signal, \{ page: "\/" \}\)/);
    expect(accueil).toMatch(/parler=\{ouvert === "parler" \? <ConversationMaison/);
  });

  it("toucher LIA ouvre « Parler », comme la maquette (surToucher, lia-ui v0.33.0)", () => {
    const accueil = readFileSync("app/AccueilClient.tsx", "utf8");
    expect(accueil).toMatch(/surToucher=\{ouvrirParler\}/);
    expect(accueil).toMatch(/const ouvrirParler = useCallback\(\(\) => \{[\s\S]{0,200}setOuvert\("parler"\);\s*return true;/);
  });
});
