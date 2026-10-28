// lib/lia/retenir.ts — LIA retient SEULE ce que Marc lui dit (ADR 0033, voie A, tâche MemoryAI 420).
//
// Avant : « l'outil pour proposer un fait n'est pas disponible dans cette session » (Marc, 28/10) —
// LIA, depuis le hub et la maison, n'avait aucun outil d'écriture, et Marc devait valider à la main.
// Ici, elle en a UN, étroit : `lia_retenir`. La décision est dans `lib/declaration.ts` (PURE) ; ce
// module lit la base, appelle le modèle et écrit. Il n'ajoute aucune règle.
//
// ⚠️ LA PREUVE EST LA PAROLE DE MARC, lue par le SERVEUR (`paroleDeMarc`), jamais passée par le modèle :
// ses propres messages, rien de ce que LIA ou un outil a écrit. Le modèle propose un prédicat et une
// valeur ; le code vérifie que la valeur se lit TELLE QUELLE dans les mots de Marc. Sinon RIEN n'est
// écrit : un fait dont la valeur ne vient pas de lui n'a pas à porter sa signature (« dit par Marc »).
// ⚠️ DEUX SIGNAUX, comme l'ADR 0025 : le code (valeur dans la parole), puis une relecture par un
// modèle indépendant (Haiku, prompt à part). Les deux, ou le fait reste `propose`.
// ⚠️ JAMAIS SEUL : niveau 3, canari, oublié, prédicat refusé par Marc. Un fait qui en contredit un
// autre déjà VALIDÉ n'est pas écrasé : il reste proposé. Au plus 20 validations par jour (Québec).
// ⚠️ UN PRÉDICAT NEUF N'EST PAS REFUSÉ (ADR 0033 A3) : il est créé, et accepté si — et seulement si —
// le fait est validé par la phrase de Marc. Le niveau PLANCHER 2 reste (servi derrière MEMORYAI_N2_CHAT).
// ⚠️ La question n'est JAMAIS journalisée, ni la valeur : l'échec écrit le nom de l'erreur, rien d'autre.

import { and, count, eq, like } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import type { ClientModele } from "../chat/agent";
import { chiffrer, dechiffrer, empreinte, type Cle } from "../chiffrement";
import { budgetOuvert, coutUsd, jourQuebec, lireUsage, type IdModele } from "../coutChat";
import {
  deciderDeclaration,
  demandeDeclaration,
  phraseDeclaration,
  PREUVE_MAX,
  preuveRecevable,
  PROMPT_DECLARATION,
  signalDuCode,
  type DecisionDeclaration,
  type Declaration,
} from "../declaration";
import { depotAdminDrizzle, type DepotAdmin } from "../depotAdmin";
import { depotDrizzle, type DepotFaits } from "../depotFaits";
import { ecrireLot } from "../ecrireFaits";
import type { Ecrivain } from "../jetons";
import { reglagesLecture } from "../reglagesModele";
import { depotRelectureDrizzle, type DepotRelecture } from "../relectureLia";
import { lireVerdicts, type Relecture } from "../validationLia";
import { validerFait, type FaitValide } from "../validerFait";
import { definition } from "../vocabulaire";

/** Le nom de cette lecture dans la trace : il VERSIONNE la façon de retenir, comme un extracteur. */
export const EXTRACTEUR_RETENIR = "lia-retenir-v1";
/** Haiku : la relecture compare une phrase à un fait, elle n'a pas à raisonner long. */
const MODELE_RETENIR: IdModele = "claude-haiku-5-5";
const MAX_TOKENS_SORTIE = 600;
/** L'écrivain derrière `lia_retenir` : LIA, qui rapporte la parole de Marc (fiabilité `marc`). */
const ECRIVAIN_LIA: Ecrivain = { appId: "lia", role: "ecriture", fiabilites: ["marc"] };

/** Ce que l'outil rend au modèle : une phrase vraie, et si le fait est resté hors de la mémoire. */
export interface ResultatRetenir {
  ok: boolean;
  phrase: string;
}

/** La capacité que `tourDeChat` offre au modèle sous le nom `lia_retenir`. Absente, l'outil n'est pas offert. */
export interface RetenirLia {
  retenir(entree: Record<string, unknown>, maintenant: Date): Promise<ResultatRetenir>;
}

/** Ce que la décision lit et écrit en base, derrière une interface (comme `DepotRelecture`). */
export interface DepotRetenir {
  /** L'état du prédicat dans la file des propositions, ou `null` s'il n'y est pas. */
  statutPredicat(predicat: string): Promise<string | null>;
  /** Les prédicats d'une contradiction ouverte (une question à choix posée à Marc). */
  predicatsEnContradiction(): Promise<ReadonlySet<string>>;
  /** Les faits validés aujourd'hui par cette voie (jour de Québec). */
  dejaValidesAujourdhui(jour: string): Promise<number>;
  /** Écrit la trace, PUIS valide le fait s'il le faut (et seulement s'il est encore `propose`). */
  tracer: DepotRelecture["tracer"];
}

export interface DepsRetenir {
  /** Les mots de Marc (`paroleDeMarc`) : la SEULE preuve. */
  parole: string;
  cle: Cle;
  faits: DepotFaits;
  depot: DepotRetenir;
  admin: DepotAdmin;
  client: ClientModele;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export function depotRetenirDrizzle(db: Base): DepotRetenir {
  const relecture = depotRelectureDrizzle(db);
  const V = schema.validationsLia;
  return {
    async statutPredicat(predicat) {
      const [ligne] = await db
        .select({ statut: schema.predicatsProposes.statut })
        .from(schema.predicatsProposes)
        .where(eq(schema.predicatsProposes.predicat, predicat))
        .limit(1);
      return ligne?.statut ?? null;
    },
    predicatsEnContradiction: () => relecture.predicatsEnContradiction(),
    async dejaValidesAujourdhui(jour) {
      const [r] = await db
        .select({ n: count() })
        .from(V)
        .where(and(eq(V.jour, jour), eq(V.decision, "valide"), like(V.extracteur, `${EXTRACTEUR_RETENIR}%`)));
      return Number(r?.n ?? 0);
    },
    tracer: (t, valider) => relecture.tracer(t, valider),
  };
}

/** LIA prête à retenir, branchée sur la vraie base : un tour de chat, une parole. */
export function retenirLiaDrizzle(db: Base, params: { messages: readonly { role: string; content: string }[]; cle: Cle; client: ClientModele }): RetenirLia {
  return fabriquerRetenir({
    parole: paroleDeMarc(params.messages),
    cle: params.cle,
    faits: depotDrizzle(db),
    depot: depotRetenirDrizzle(db),
    admin: depotAdminDrizzle(db),
    client: params.client,
  });
}

/**
 * La parole de Marc : SES messages seulement (jamais ceux de LIA), les plus récents d'abord tant
 * qu'ils tiennent dans la longueur de la preuve. Le dernier message trop long à lui seul donne une
 * parole VIDE (donc rien n'est retenu) : on ne coupe jamais un message en deux, ce serait déplacer
 * ce qu'il dit.
 */
export function paroleDeMarc(messages: readonly { role: string; content: string }[]): string {
  const gardes: string[] = [];
  let total = 0;
  for (const m of [...messages].reverse()) {
    if (m.role !== "user") continue;
    const t = m.content.trim();
    if (t.length === 0) continue;
    if (total + t.length + 1 > PREUVE_MAX.marc) break;
    gardes.unshift(t);
    total += t.length + 1;
  }
  return gardes.join("\n");
}

const refus = (phrase: string): ResultatRetenir => ({ ok: false, phrase });

export function fabriquerRetenir(deps: DepsRetenir): RetenirLia {
  return {
    async retenir(entree, maintenant) {
      try {
        return await retenirUn(deps, entree, maintenant);
      } catch (err) {
        // Le NOM de l'erreur, jamais son message : il peut citer la valeur de Marc.
        console.error("[lia_retenir] impossible", err instanceof Error ? err.name : "erreur");
        return refus("Je n'ai pas pu le retenir : une erreur est survenue de mon côté. Rien n'est validé.");
      }
    },
  };
}

async function retenirUn(deps: DepsRetenir, entree: Record<string, unknown>, maintenant: Date): Promise<ResultatRetenir> {
  const preuve = preuveRecevable("marc", deps.parole);
  if (preuve === null) return refus("Je n'ai pas pu le retenir : ton message est vide ou dépasse 2 000 caractères.");

  const jour = jourQuebec(maintenant);
  const brut = {
    sujet: "marc",
    predicat: entree.predicat,
    valeur: entree.valeur,
    valeur_type: entree.valeur_type,
    provenance: { source_type: "marc", source_ref: `lia-marc:${jour}`, extracteur: EXTRACTEUR_RETENIR, date_source: jour },
  };
  // Les mêmes gardes que toute écriture (`ecrireLot` les rejouera) : montant, position, numéro d'identité…
  const v = validerFait(brut, { fiabilites: ECRIVAIN_LIA.fiabilites });
  if (!v.ok) return refus(`Je ne l'ai pas retenu : ${v.raison}.`);

  // Signal n° 1, SANS modèle : la valeur se lit-elle telle quelle dans les mots de Marc ?
  if (!signalDuCode(v.valeur, v.valeurType, preuve)) {
    return refus(
      "Je n'ai pas retrouvé cette valeur telle quelle dans ce que tu as écrit : je ne la retiens pas. Redemande-la avec les mots exacts de Marc.",
    );
  }

  const decl: Declaration = {
    voie: "marc",
    niveau: v.niveau,
    canari: v.canari,
    oublie: false,
    predicatRefuse: (await deps.depot.statutPredicat(v.predicat)) === "refuse",
    predicatDeclarable: true,
    enContradiction: (await deps.depot.predicatsEnContradiction()).has(v.predicat),
    contreditUnValide: await contreditUnValide(deps, v),
    dejaValidesAujourdhui: await deps.depot.dejaValidesAujourdhui(jour),
  };
  // Tout ce qui ne dépend pas du modèle se décide AVANT de le payer.
  let decision: DecisionDeclaration = deciderDeclaration(decl, true, null);
  if (decision.genre === "exclu" && (decision.raison === "canari" || decision.raison === "predicat-refuse")) {
    return refus(phraseDeclaration(decision));
  }

  const lot = await ecrireLot([brut], ECRIVAIN_LIA, deps.cle, deps.faits, maintenant);
  const refuse = lot.refuses[0];
  if (refuse) {
    if (refuse.code === "oublie") return refus(phraseDeclaration({ genre: "exclu", raison: "oublie" }));
    if (refuse.code === "doublon_valide") return { ok: true, phrase: "Je le savais déjà : c'est déjà validé tel quel." };
    return refus(`Je ne l'ai pas retenu : ${refuse.raison}.`);
  }
  const id = lot.idsCrees[0];
  if (id === undefined) return { ok: true, phrase: "Je le connaissais déjà : rien n'a changé." };

  // Signal n° 2 : seulement si rien d'autre ne tranche. Le fait est déjà écrit `propose` : un échec
  // du modèle le laisse là, jamais validé.
  let nouvelleRubrique = false;
  if (decision.genre === "doute" && decision.raison === "verdict-illisible") {
    const relecture = await relire(deps, preuve, v, jour);
    decision = deciderDeclaration(decl, true, relecture);
    await deps.depot.tracer(
      {
        faitId: id,
        decision: decision.genre === "valider" ? "valide" : "doute",
        verdict: relecture?.verdict ?? null,
        signalCode: true,
        raison: relecture ? chiffrer(deps.cle, relecture.raison, `${id}#lia`, v.niveau) : null,
        empreinteSource: empreinte(deps.cle, "lia-source", preuve),
        empreinteValeur: empreinte(deps.cle, "lia-valeur", v.valeur),
        extracteur: `${EXTRACTEUR_RETENIR}|${MODELE_RETENIR}`,
        jour,
        enPile: false,
        reluLe: maintenant,
      },
      decision.genre === "valider",
    );
    // Un prédicat neuf sort de quarantaine par la phrase de Marc, quand le fait est validé (A3).
    if (decision.genre === "valider" && v.predicatHorsVocabulaire) {
      nouvelleRubrique = (await deps.admin.trancherPredicat(v.predicat, "accepte", maintenant)) === "ok";
    }
  }

  const phrase = phraseDeclaration(decision);
  return { ok: true, phrase: nouvelleRubrique ? `${phrase} J'ai ajouté cette rubrique (${v.predicat}) à ce que je sais tenir.` : phrase };
}

/**
 * Un fait VALIDE du même prédicat porte-t-il une AUTRE valeur ? Alors on n'écrase rien : le fait reste
 * proposé. Un prédicat `multi` accepte plusieurs valeurs ; un prédicat neuf (sans définition) est
 * traité comme n'en tenant qu'une, le côté prudent. Une valeur illisible compte comme une contradiction.
 */
async function contreditUnValide(deps: DepsRetenir, v: FaitValide): Promise<boolean> {
  if (definition(v.predicat, v.versionVocabulaire)?.multi) return false;
  const lignes = await deps.faits.valeursValidees(v.sujet, [v.predicat]);
  return lignes.some((l) => {
    if (l.valeur === null) return false;
    try {
      const claire = l.niveau >= 1 ? dechiffrer(deps.cle, l.valeur, l.id, l.niveau) : l.valeur;
      return claire !== v.valeur;
    } catch {
      return true;
    }
  });
}

/** Le signal n° 2 : un modèle INDÉPENDANT relit la phrase de Marc et le fait. `null` = pas de verdict. */
async function relire(deps: DepsRetenir, parole: string, v: FaitValide, jour: string): Promise<Relecture | null> {
  try {
    const depense = await deps.admin.depenseDuJourUsd(jour, "chat");
    if (!budgetOuvert(depense, "chat", await deps.admin.plafonds())) return null;
    const reponse = await deps.client.create({
      model: MODELE_RETENIR,
      max_tokens: MAX_TOKENS_SORTIE,
      ...reglagesLecture(MODELE_RETENIR),
      system: PROMPT_DECLARATION,
      tools: [],
      messages: [
        {
          role: "user",
          content: demandeDeclaration(parole, {
            description: definition(v.predicat, v.versionVocabulaire)?.description ?? v.predicat,
            predicat: v.predicat,
            valeur: v.valeur,
          }),
        },
      ],
    });
    // COMPTÉ AVANT D'ÊTRE LU : l'appel est facturé même si la réponse est inutilisable.
    const { usage } = lireUsage(reponse.usage);
    await deps.admin.enregistrerDepense({ jour, poste: "chat", modele: MODELE_RETENIR, ...usage, coutUsd: coutUsd(MODELE_RETENIR, usage) });
    const texte = reponse.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return lireVerdicts(texte).get(1) ?? null;
  } catch (err) {
    console.error("[lia_retenir] relecture impossible", err instanceof Error ? err.name : "erreur");
    return null;
  }
}
