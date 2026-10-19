// lib/corrigerFait.ts — [L33b] corriger un fait, et RENDRE LA CAUSE quand ça ne marche pas.
//
// ── POURQUOI CE MODULE EXISTE À PART DE LA SERVER ACTION ─────────────────────────────────
//
// La Server Action (`app/fait/[id]/actions.ts`) fait trois choses que la logique n'a pas à
// savoir : vérifier la session, choisir une redirection, rafraîchir des chemins Next. Tout
// ça est intestable sans monter Next. Ce qui se teste — écrire la bonne valeur, périmer
// l'ancienne, refuser honnêtement — vit ici, sur un dépôt et une clé, comme le reste du lib.
//
// ⚠️ Et le retour est une UNION DISCRIMINÉE, jamais un booléen. Leçon du dépôt : « un service
// qui rend la même valeur pour N situations rend son écran MUET ». Ici les N situations sont
// réelles — champ vide, fait disparu, type non corrigeable, refus du contrat, valeur déjà en
// mémoire — et chacune demande une phrase DIFFÉRENTE à Marc. Les aplatir en `false` obligerait
// l'écran à inventer la cause.
//
// ── CE QU'IL N'INVENTE PAS ───────────────────────────────────────────────────────────────
//
// Mesuré avant d'écrire : tout le mécanisme existait déjà. `ecrireLot(…, MARC, …)` est le
// chemin par lequel Marc écrit depuis le lot des questions, et `valider` PÉRIME tout seul les
// autres faits validés du même prédicat non `multi` (c'est écrit dans son corps). Corriger,
// c'est donc « écrire la bonne valeur et la valider ». Aucun mutateur neuf, aucun champ neuf,
// aucune frontière déplacée — l'ADR que j'annonçais aurait délibéré sur une décision déjà
// prise par le schéma.

import type { Cle } from "./chiffrement";
import type { DepotAdmin } from "./depotAdmin";
import type { DepotFaits } from "./depotFaits";
import { ecrireLot } from "./ecrireFaits";
import type { Ecrivain } from "./jetons";
import { definition } from "./vocabulaire";

/**
 * L'écrivain d'une correction. ⚠️ `fiabilites: ["marc"]` et rien d'autre : une correction
 * tapée par Marc n'a pas la fiabilité d'un document officiel, **même quand elle corrige un
 * document officiel**. Ce qu'il sait, il le sait ; rien ne l'a vérifié. Hériter de la
 * fiabilité de l'ancien fait ferait entrer une fiabilité qu'aucune source ne soutient.
 */
export const ECRIVAIN_CORRECTION: Ecrivain = { appId: "marc", role: "ecriture", fiabilites: ["marc"] };

/** Ce qui se retape au clavier. Un `ref_document` a pour valeur un fileId : voir le refus. */
const TYPES_CORRIGEABLES = new Set(["texte", "date"]);

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export type Correction =
  | { ok: true; nouveauId: string; ancienPerime: boolean }
  /** `code` est soit une issue de cette fonction, soit un `CODES_REFUS` du contrat. */
  | { ok: false; code: string };

export async function corrigerFait(
  ancienId: string,
  valeurBrute: string,
  deps: { admin: DepotAdmin; faits: DepotFaits; cle: Cle },
  maintenant: Date = new Date(),
): Promise<Correction> {
  const valeur = valeurBrute.trim();
  if (valeur.length === 0) return { ok: false, code: "vide" };

  const ancien = await deps.admin.parId(ancienId);
  if (!ancien) return { ok: false, code: "introuvable" };
  if (!TYPES_CORRIGEABLES.has(ancien.fait.valeurType)) return { ok: false, code: "type-non-corrigeable" };

  const r = await ecrireLot(
    [
      {
        sujet: ancien.fait.sujet,
        predicat: ancien.fait.predicat,
        valeur,
        // Le type se DÉDUIT de ce qui est tapé, comme dans `repondreAction`. Si le vocabulaire
        // ne l'accepte pas pour ce prédicat, le contrat REFUSE — et le refus remonte tel quel
        // plutôt qu'une coercition silencieuse vers le type attendu.
        valeur_type: ISO.test(valeur) ? "date" : "texte",
        provenance: {
          source_type: "marc",
          // La correction EST la source, et elle nomme le fait corrigé : ça rend la chaîne
          // traçable, et l'idempotence par empreinte fait que recliquer la même correction ne
          // crée pas un second fait.
          source_ref: `correction:${ancienId}`,
          extracteur: "page-fait-v1",
          date_source: maintenant.toISOString().slice(0, 10),
        },
      },
    ],
    ECRIVAIN_CORRECTION,
    deps.cle,
    deps.faits,
    maintenant,
  );

  const nouveauId = r.idsCrees[0];
  if (nouveauId === undefined) {
    // ⚠️ RIEN n'est touché sur l'ancien fait dans ce cas. Se taire laisserait croire que la
    // correction est passée, ce qui est pire que l'échec : Marc repartirait en croyant sa
    // mémoire à jour.
    return { ok: false, code: r.refuses[0]?.code ?? (r.dejaPresents > 0 ? "deja-present" : "refuse") };
  }

  await deps.admin.valider(nouveauId, maintenant);

  // Pour un prédicat NON `multi`, `valider` vient de périmer l'ancien tout seul. Pour un
  // prédicat `multi` (« un ancien employeur », « une compétence »), une valeur de plus ne
  // remplace RIEN : sans ce geste les deux coexistent et la correction n'a rien corrigé — elle
  // a ajouté. ⚠️ `perimer` et non `rejeter` : « remplacé par un plus récent », pas « faux ».
  // L'ancienne valeur était vraie à sa date, et c'est pour ça qu'on la garde.
  const def = definition(ancien.fait.predicat, ancien.fait.versionVocabulaire);
  if (def?.multi) await deps.admin.perimer(ancienId);

  return { ok: true, nouveauId, ancienPerime: true };
}
