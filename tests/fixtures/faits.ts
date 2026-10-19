// tests/fixtures/faits.ts — un fait valide de référence, partagé par les tests d'écriture.
// Hors du motif `tests/**/*.test.ts` : un fichier de test importé par un autre y rejouerait
// tous ses cas.

export const BON = {
  sujet: "marc",
  predicat: "emploi.employeur",
  valeur: "Entreprise Exemple",
  valeur_type: "texte",
  provenance: { source_type: "document", source_ref: "1AbCdEfGhIjKlMnOp", extracteur: "moteur-inventaire-v1" },
};
