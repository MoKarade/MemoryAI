// tests/plongement.test.ts — tests unitaires pour plongeurLocal avec la bibliothèque simulée.
// Données FICTIVES. Aucun modèle n'est téléchargé, aucun réseau n'est appelé.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEnv = {
  cacheDir: "",
  allowLocalModels: true,
};

const mockExtraire = vi.fn();
const mockPipeline = vi.fn();

vi.mock("@huggingface/transformers", () => ({
  env: mockEnv,
  pipeline: mockPipeline,
}));

import { plongeurLocal } from "../lib/plongement";

describe("plongeurLocal (bibliothèque simulée)", () => {
  beforeEach(() => {
    mockEnv.cacheDir = "";
    mockEnv.allowLocalModels = true;
    mockExtraire.mockReset();
    mockPipeline.mockReset();
    mockPipeline.mockResolvedValue(mockExtraire);
  });

  it("règle env.cacheDir sur /tmp/memoryai-modeles et env.allowLocalModels sur false", async () => {
    await plongeurLocal();

    expect(mockEnv.cacheDir).toBe("/tmp/memoryai-modeles");
    expect(mockEnv.allowLocalModels).toBe(false);
  });

  it("appelle pipeline avec 'feature-extraction', le nom, la révision, le type et le périphérique épinglés", async () => {
    await plongeurLocal();

    expect(mockPipeline).toHaveBeenCalledTimes(1);
    expect(mockPipeline).toHaveBeenCalledWith(
      "feature-extraction",
      "Xenova/paraphrase-multilingual-mpnet-base-v2",
      {
        revision: "e5d116277351513fd260955ece953ecddde7046e",
        dtype: "q8",
        device: "cpu",
      },
    );
  });

  it("découpe 70 textes fictifs en 3 paquets de 32, 32 et 6, et concatène les vecteurs dans l'ordre", async () => {
    mockExtraire.mockImplementation(async (batch: string[]) => ({
      tolist: () => batch.map((t) => [parseInt(t.split(" ")[2]!, 10)]),
    }));

    const plongeur = await plongeurLocal();

    const textesFictifs = Array.from({ length: 70 }, (_, i) => `texte fictif ${i}`);
    const resultats = await plongeur(textesFictifs);

    expect(mockExtraire).toHaveBeenCalledTimes(3);

    expect(mockExtraire).toHaveBeenNthCalledWith(
      1,
      textesFictifs.slice(0, 32),
      { pooling: "mean", normalize: true },
    );
    expect(mockExtraire).toHaveBeenNthCalledWith(
      2,
      textesFictifs.slice(32, 64),
      { pooling: "mean", normalize: true },
    );
    expect(mockExtraire).toHaveBeenNthCalledWith(
      3,
      textesFictifs.slice(64, 70),
      { pooling: "mean", normalize: true },
    );

    expect(resultats).toHaveLength(70);
    expect(resultats).toEqual(textesFictifs.map((_, i) => [i]));
  });

  it("rend [] sans appeler l'extracteur lorsqu'aucun texte n'est fourni", async () => {
    const plongeur = await plongeurLocal();

    const resultats = await plongeur([]);

    expect(resultats).toEqual([]);
    expect(mockExtraire).not.toHaveBeenCalled();
  });

  it("propage l'erreur si pipeline rejette", async () => {
    const erreur = new Error("Erreur fictive lors du chargement du modèle");
    mockPipeline.mockRejectedValue(erreur);

    await expect(plongeurLocal()).rejects.toThrow(erreur);
  });
});
