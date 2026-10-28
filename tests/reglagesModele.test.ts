// tests/reglagesModele.test.ts — réglages d'appel par modèle, PURS.
//
// La famille 5.5 pense par défaut (et la pensée compte dans `max_tokens`) ; `thinking: disabled`
// est refusé (400) par Sonnet 5.5 et Opus 5.5 ; `temperature` n'existe plus.

import { describe, it, expect } from "vitest";
import { MODELES } from "../lib/coutChat";
import { reglagesChat, reglagesLecture } from "../lib/reglagesModele";

describe("reglagesLecture", () => {
  it("Haiku 5.5 : pensée coupée, effort bas", () => {
    expect(reglagesLecture("claude-haiku-5-5")).toEqual({ thinking: { type: "disabled" }, output_config: { effort: "low" } });
  });

  it("Sonnet 5.5 : jamais `disabled` (400), `between_tools`", () => {
    expect(reglagesLecture("claude-sonnet-5-5")).toEqual({ thinking: { type: "between_tools" }, output_config: { effort: "medium" } });
  });

  it("Opus 5.5 : la pensée ne se coupe pas, aucun champ `thinking`", () => {
    const r = reglagesLecture("claude-opus-5-5");
    expect(r.thinking).toBeUndefined();
    expect(r.output_config).toEqual({ effort: "low" });
  });

  it("chaque modèle du sélecteur a un réglage de lecture et de chat (aucun oubli)", () => {
    for (const m of MODELES) {
      expect(reglagesLecture(m.id).output_config, m.id).toBeDefined();
      expect(reglagesChat().output_config, m.id).toBeDefined();
    }
  });
});
