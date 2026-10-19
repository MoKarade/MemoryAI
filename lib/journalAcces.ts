// lib/journalAcces.ts — écrire une entrée dans le journal d'accès, chaînée à la précédente.
//
// `lib/journal.ts` signe (pur) ; ce module lit la tête de chaîne, signe, insère — et
// recommence UNE fois si une écriture concurrente a pris la même tête (index unique sur
// `hmac_precedent`, migration 0001). Sans cet index, deux lecteurs simultanés forkeraient
// la chaîne en silence ; avec lui, le second relit et re-signe.
//
// Un accès qui ne PEUT PAS être journalisé (clé absente, insertion impossible deux fois)
// lève : l'outil ne rend alors rien. Servir sans journaliser est exactement ce que le
// journal existe pour empêcher.
//
// ⚠️ ADR 0014 : toute NOUVELLE entrée s'écrit en `VERSION_JOURNAL_ACTUELLE` (v2, avec les
// papiers lus) — jamais en v1. La version vient du CODE, jamais d'une valeur par défaut de
// la colonne (`lib/db/schema.ts`, qui vaut 1 pour ne pas mentir sur l'historique) : un
// chemin d'écriture qui l'omettrait produirait silencieusement une entrée dont le corpus
// signé NE CONTIENT PAS `idsPieces`, alors que la colonne stockerait quand même la valeur —
// un journal qui affirme moins que ce qu'il contient.

import type { DepotLecture } from "./depotLecture";
import { signerEntree, VERSION_JOURNAL_ACTUELLE, type EntreeASigner } from "./journal";

export interface AccesAJournaliser {
  lecteur: string;
  outil: string;
  usage: "conversation" | "action";
  niveauMaxServi: number;
  idsFaits: string[];
  /** ADR 0014 (revue #72) : les papiers lus, au même titre que les faits. */
  idsPieces?: string[];
  questionEmpreinte: string | null;
  coutUsd?: number | null;
}

export async function journaliserAcces(
  depot: DepotLecture,
  cleJournal: Buffer,
  acces: AccesAJournaliser,
  maintenant: () => Date = () => new Date(),
): Promise<void> {
  let derniereErreur: unknown = null;
  for (let essai = 0; essai < 2; essai++) {
    const tete = await depot.derniereEntreeJournal();
    const ts = maintenant();
    const idsPieces = acces.idsPieces ?? [];
    const aSigner: EntreeASigner = {
      version: VERSION_JOURNAL_ACTUELLE,
      ts: ts.toISOString(),
      lecteur: acces.lecteur,
      outil: acces.outil,
      usage: acces.usage,
      niveauMaxServi: acces.niveauMaxServi,
      idsFaits: acces.idsFaits,
      idsPieces,
      questionEmpreinte: acces.questionEmpreinte,
    };
    const signee = signerEntree(cleJournal, tete?.hmac ?? null, aSigner);
    try {
      await depot.journaliser({
        ts,
        version: VERSION_JOURNAL_ACTUELLE,
        lecteur: acces.lecteur,
        outil: acces.outil,
        usage: acces.usage,
        niveauMaxServi: acces.niveauMaxServi,
        idsFaits: acces.idsFaits,
        idsPieces,
        questionEmpreinte: acces.questionEmpreinte,
        coutUsd: acces.coutUsd ?? null,
        hmacPrecedent: signee.hmacPrecedent,
        hmac: signee.hmac,
      });
      return;
    } catch (err) {
      derniereErreur = err;
    }
  }
  throw derniereErreur instanceof Error ? derniereErreur : new Error("journal d'accès : écriture impossible");
}
