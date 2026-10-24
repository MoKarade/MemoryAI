// lib/lia/etatPartage.ts — l'état PARTAGÉ de LIA (contrat `commun/assistant/CONTRAT-etat-lia.md`,
// lia-ui ≥ v0.12) : ce qui fait d'elle UNE seule LIA, quel que soit l'hôte. PUR : la forme, les
// bornes et la décision ; l'I/O vit dans `depotEtat.ts`, les routes dans `app/api/…`.
//
// Aucun contenu de Marc : des nombres, des verbes de LIA et un nom d'humeur. Les bornes sont
// celles de `validerEtat` côté paquet : une entrée de journal ou de mémoire lente hors bornes est
// RETIRÉE (le paquet fait pareil), une clé inconnue aussi ; un champ obligatoire faux refuse tout.

import { z } from "zod";

/** Au-delà, 413 avant même de lire le JSON (contrat : 16 Ko). */
export const TAILLE_MAX_ETAT = 16 * 1024;
const VERSION_MAX = 1_000_000_000;
const JOURNAL_MAX = 20;
const LENTE_MAX = 80;

const fraction = z.number().finite().min(0).max(1);
/** Un verbe de LIA (`COMPORTEMENTS` du paquet : voir, jouer, rappeler…) : des minuscules, rien d'autre. */
const Verbe = z.string().regex(/^[a-z]{1,20}$/);
const Fait = z.object({ t: z.number().finite().gt(0), quoi: Verbe });
/**
 * Son monde intérieur (lia-ui ≥ v0.20.0, optionnel) : des fractions et une cause prise dans une
 * liste fermée. Non conforme : RETIRÉ, jamais l'état entier (comme `validerInterieur` du paquet).
 * ⚠️ Copie provisoire des bornes : à remplacer par `validerEtat` exporté par lia-ui v0.22.0.
 */
const CAUSES = ["choc", "brusque", "ton", "panne", "isolement", "usure"] as const;
const Interieur = z.object({
  douleur: fraction,
  sensibilite: fraction,
  plaisir: fraction,
  confiance: fraction,
  usure: fraction,
  cause: z.enum(CAUSES).nullable(),
});

export const EtatPartage = z.object({
  version: z.number().int().min(0).max(VERSION_MAX),
  maj: z.number().finite().gt(0),
  envies: z.object({
    energie: fraction,
    curiosite: fraction,
    social: fraction,
    inquiet: fraction,
    joie: fraction,
    ennui: fraction,
  }),
  journal: z
    .array(z.unknown())
    .max(200)
    .transform((l) =>
      l
        .map((f) => Fait.safeParse(f))
        .flatMap((r) => (r.success ? [r.data] : []))
        .slice(-JOURNAL_MAX),
    ),
  lente: z
    .record(z.string(), z.unknown())
    .optional()
    .transform((o) => {
      const propre: Record<string, number> = {};
      for (const [k, v] of Object.entries(o ?? {}).slice(0, LENTE_MAX)) {
        if (/^[A-Za-z0-9_-]{1,40}$/.test(k) && fraction.safeParse(v).success) propre[k] = v as number;
      }
      return propre;
    }),
  humeur: z.string().regex(/^[a-zà-ÿ_-]{1,40}$/i),
  relances: z.object({
    jour: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    n: z.number().int().min(0).max(100),
  }),
  interieur: z
    .unknown()
    .optional()
    .transform((v) => {
      const r = Interieur.safeParse(v);
      return r.success ? r.data : undefined;
    }),
});
export type EtatPartage = z.infer<typeof EtatPartage>;

export type LectureEtat =
  | { ok: true; etat: EtatPartage }
  | { ok: false; status: 400 | 413; code: string; message: string };

/** Lit le corps BRUT d'un PUT. Les erreurs nomment des champs, jamais des valeurs. */
export function lireEtat(brut: string): LectureEtat {
  if (Buffer.byteLength(brut, "utf8") > TAILLE_MAX_ETAT) {
    return { ok: false, status: 413, code: "corps_trop_gros", message: `Corps au-delà de ${TAILLE_MAX_ETAT} octets.` };
  }
  let json: unknown;
  try {
    json = JSON.parse(brut);
  } catch {
    return { ok: false, status: 400, code: "corps_invalide", message: "JSON attendu." };
  }
  const r = EtatPartage.safeParse(json);
  if (!r.success) {
    const champs = [...new Set(r.error.issues.map((i) => i.path.join(".") || "(racine)"))].join(", ");
    return { ok: false, status: 400, code: "corps_invalide", message: `Champs invalides : ${champs}.` };
  }
  return { ok: true, etat: r.data };
}

/** Ce que la base garde déjà est-il relu tel quel ? Une ligne abîmée n'est jamais rendue : `null`. */
export function relireEtat(garde: unknown): EtatPartage | null {
  const r = EtatPartage.safeParse(garde);
  return r.success ? r.data : null;
}
