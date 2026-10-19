// tests/chatDepart.test.ts — ce que le chat reprend de l'onglet (lib/chat/depart.ts), et le
// garde qui l'empêche de l'écraser avant de l'avoir relu (app/chat/ChatClient.tsx).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { departDeSession, DEPART_VIDE } from "../lib/chat/depart";

const MODELES = ["haiku", "sonnet"];

describe("departDeSession", () => {
  it("rend un départ vide sans session ni brouillon", () => {
    expect(departDeSession(null, null, MODELES)).toEqual(DEPART_VIDE);
  });

  it("reprend les messages, le modèle et l'identifiant de la conversation", () => {
    const brut = JSON.stringify({
      messages: [{ role: "user", content: "bonjour" }],
      modele: "sonnet",
      conversationId: "c-1",
    });
    const d = departDeSession(brut, null, MODELES);
    expect(d.messages).toEqual([{ role: "user", content: "bonjour" }]);
    expect(d.modele).toBe("sonnet");
    expect(d.conversationId).toBe("c-1");
  });

  it("ignore un modèle qui n'est plus offert (on garde celui par défaut de la page)", () => {
    const d = departDeSession(JSON.stringify({ messages: [], modele: "disparu" }), null, MODELES);
    expect(d.modele).toBeNull();
  });

  it("ignore des champs du mauvais type plutôt que de les propager", () => {
    const d = departDeSession(JSON.stringify({ messages: "pas un tableau", conversationId: 12 }), null, MODELES);
    expect(d.messages).toEqual([]);
    expect(d.conversationId).toBeNull();
  });

  it("une session illisible repart vide, mais le brouillon de /partage reste", () => {
    const d = departDeSession("{pas du json", "ma question", MODELES);
    expect(d.messages).toEqual([]);
    expect(d.brouillon).toBe("ma question");
  });

  it("un brouillon vide n'est pas un brouillon", () => {
    expect(departDeSession(null, "", MODELES).brouillon).toBeNull();
  });
});

describe("ChatClient — la session de l'onglet n'est pas écrasée avant d'être relue", () => {
  const src = readFileSync(resolve(process.cwd(), "app/chat/ChatClient.tsx"), "utf8");

  it("l'écriture dans sessionStorage attend la restauration", () => {
    const effet = src.slice(src.indexOf("sessionStorage.setItem(CLE_SESSION") - 400, src.indexOf("sessionStorage.setItem(CLE_SESSION"));
    expect(effet).toMatch(/if \(!restaurer\) return;/);
  });

  it("la restauration passe par useSyncExternalStore, pas par un effet qui rappelle setState", () => {
    expect(src).toContain("useSyncExternalStore");
    expect(src).not.toMatch(/useEffect\(\(\) => \{\s*try \{\s*const brut = sessionStorage\.getItem/);
  });
});
