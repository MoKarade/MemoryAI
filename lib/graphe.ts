// lib/graphe.ts — les liens entre faits (ADR 0002 §5.3). PURE : aucune base, aucun réseau,
// aucune horloge. On lui donne des faits et des questions, il rend des liens.
//
// ⚠️ LES CINQ RÈGLES SONT DÉTERMINISTES, ET C'EST LE POINT. Marc a tranché le 15/09 : « les
// liens se font par RÈGLES d'abord, par modèle ensuite ». Une règle est testable et
// EXPLICABLE — chaque lien porte la phrase qui dit pourquoi il existe, en clair, à l'écran.
// Un lien deviné par un modèle portera `origine: "modele"` et sera dessiné autrement : un
// graphe qui mélange ce qui est établi et ce qui est deviné n'apprend rien à personne.
//
// ⚠️ UNE RÈGLE DE LIAISON EST QUADRATIQUE PAR NATURE. Huit faits qui partagent un attribut
// font 28 liens ; quarante en font 780, et le graphe devient un mur. Les règles de groupe
// s'ABSTIENNENT donc au-delà de `TAILLE_MAX_GROUPE`, et l'abstention est COMPTÉE et NOMMÉE
// (`abstentions`) — un graphe amputé en silence se présenterait comme un graphe complet.

import type { Attributs } from "./validerFait";

export const TAILLE_MAX_GROUPE = 8;

/** Ce dont une règle a besoin. Volontairement plus petit que `FaitLisible`. */
export interface FaitPourGraphe {
  id: string;
  /** Le premier segment du prédicat (`emploi.employeur` devient `emploi`). */
  domaine: string;
  predicat: string;
  valeurType: string;
  /** Déchiffrée. Les règles ne comparent que des valeurs de POINTEUR et d'attribut. */
  valeur: string;
  attributs: Attributs | null;
  valideDe: string | null;
  valideA: string | null;
  remplaceId: string | null;
}

/** Une question répondue peut expliquer d'où vient un fait. */
export interface QuestionPourGraphe {
  id: string;
  question: string;
  faitId: string | null;
}

export type TypeLien =
  | "meme-document"
  | "meme-periode"
  | "remplacement"
  | "meme-domaine-meme-entite"
  | "cause-declaree";

export interface LienCalcule {
  faitA: string;
  faitB: string;
  cibleB: "fait" | "question";
  type: TypeLien;
  poids: number;
  regle: string;
  /** En clair, et sans jamais recopier une VALEUR de fait : rien ici n'est chiffré. */
  pourquoi: string;
}

export interface Abstention {
  regle: TypeLien;
  /** Ce que le groupe avait en commun, sans révéler la valeur elle-même. */
  motif: string;
  taille: number;
}

export interface ResultatGraphe {
  liens: LienCalcule[];
  abstentions: Abstention[];
}

/**
 * ⚠️ QUELLES RÈGLES SONT ORIENTÉES, ET POURQUOI ÇA COMPTE. Pour une règle SYMÉTRIQUE, la
 * paire est normalisée (`faitA < faitB`) : sans ça, la même paire entrerait deux fois selon
 * l'ordre de parcours, et l'index unique de la base ne la verrait pas passer. Pour une règle
 * ORIENTÉE, l'ordre PORTE le sens — `remplacement` va du NOUVEAU vers l'ANCIEN,
 * `cause-declaree` du fait vers la question qui l'a produit. Normaliser une paire orientée
 * l'inverserait, et le graphe dirait le contraire de ce qui s'est passé.
 */
export const REGLES_ORIENTEES: readonly TypeLien[] = ["remplacement", "cause-declaree"];

function paire(type: TypeLien, a: string, b: string): { faitA: string; faitB: string } {
  if (REGLES_ORIENTEES.includes(type)) return { faitA: a, faitB: b };
  return a < b ? { faitA: a, faitB: b } : { faitA: b, faitB: a };
}

/** Normalisation d'une valeur d'attribut : casse, accents, espaces. Jamais affichée. */
export function normaliserAttribut(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deux intervalles se chevauchent-ils ? Une borne absente signifie OUVERTE : `valideA: null`
 * veut dire « encore en cours », pas « fini aujourd'hui ». Deux faits SANS aucune date ne se
 * chevauchent pas — sinon la règle lierait toute la mémoire à elle-même.
 */
export function seChevauchent(
  a: { valideDe: string | null; valideA: string | null },
  b: { valideDe: string | null; valideA: string | null },
): boolean {
  if (a.valideDe === null && a.valideA === null) return false;
  if (b.valideDe === null && b.valideA === null) return false;
  const debutA = a.valideDe ?? "0000-01-01";
  const finA = a.valideA ?? "9999-12-31";
  const debutB = b.valideDe ?? "0000-01-01";
  const finB = b.valideA ?? "9999-12-31";
  return debutA <= finB && debutB <= finA;
}

/** Toutes les paires d'un groupe, ou RIEN si le groupe dépasse la borne (et on le dit). */
function cliqueBornee(
  ids: readonly string[],
  type: TypeLien,
  motif: string,
  faire: (a: string, b: string) => LienCalcule,
  abstentions: Abstention[],
): LienCalcule[] {
  if (ids.length < 2) return [];
  if (ids.length > TAILLE_MAX_GROUPE) {
    abstentions.push({ regle: type, motif, taille: ids.length });
    return [];
  }
  const out: LienCalcule[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      out.push(faire(ids[i] as string, ids[j] as string));
    }
  }
  return out;
}

function grouper<T>(items: readonly T[], cle: (t: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = cle(it);
    if (k === null || k === "") continue;
    const liste = m.get(k);
    if (liste) liste.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function calculerLiens(
  faits: readonly FaitPourGraphe[],
  questions: readonly QuestionPourGraphe[] = [],
): ResultatGraphe {
  const liens: LienCalcule[] = [];
  const abstentions: Abstention[] = [];
  const connus = new Set(faits.map((f) => f.id));

  // 1. `meme-document` — deux faits qui pointent le même fichier. C'est la règle la plus
  //    sûre du lot : le pointeur est un identifiant, pas une ressemblance.
  for (const [ref, groupe] of grouper(faits, (f) => (f.valeurType === "ref_document" ? f.valeur : null))) {
    liens.push(
      ...cliqueBornee(
        groupe.map((f) => f.id),
        "meme-document",
        `${groupe.length} faits pointent le même document`,
        (a, b) => ({
          ...paire("meme-document", a, b),
          cibleB: "fait" as const,
          type: "meme-document" as const,
          poids: 1,
          regle: "meme-document",
          // `ref` est un identifiant Drive, pas un contenu : le nommer n'expose rien qu'un
          // lien Drive n'expose déjà dans `/moi`. Une VALEUR de fait, elle, ne s'écrirait
          // jamais ici — `pourquoi` n'est pas chiffré.
          pourquoi: `Les deux pointent le même document (${ref.slice(0, 12)}...).`,
        }),
        abstentions,
      ),
    );
  }

  // 2. `meme-periode` — deux faits dont les périodes se chevauchent.
  //    ⚠️ BORNÉE AUX DOMAINES DIFFÉRENTS, et ce n'est pas une optimisation : l'exemple de
  //    l'ADR est « un emploi et un logement de la même année ». Deux faits du MÊME domaine
  //    qui se chevauchent sont le cas ordinaire (trois faits sur le même emploi) — les lier
  //    n'apprendrait rien et noierait les rapprochements qui, eux, surprennent.
  const dates = faits.filter((f) => f.valideDe !== null || f.valideA !== null);
  if (dates.length > TAILLE_MAX_GROUPE * 4) {
    abstentions.push({
      regle: "meme-periode",
      motif: "trop de faits datés pour une comparaison deux à deux",
      taille: dates.length,
    });
  } else {
    for (let i = 0; i < dates.length; i++) {
      for (let j = i + 1; j < dates.length; j++) {
        const a = dates[i] as FaitPourGraphe;
        const b = dates[j] as FaitPourGraphe;
        if (a.domaine === b.domaine) continue;
        if (!seChevauchent(a, b)) continue;
        liens.push({
          ...paire("meme-periode", a.id, b.id),
          cibleB: "fait",
          type: "meme-periode",
          // Plus faible que les autres : un chevauchement est une COÏNCIDENCE de dates, pas
          // un rapport établi. Le poids le dit, et l'écran s'en sert pour trier.
          poids: 0.5,
          regle: "meme-periode",
          pourquoi: `Leurs périodes se chevauchent (${a.domaine} et ${b.domaine}).`,
        });
      }
    }
  }

  // 3. `remplacement` — ORIENTÉ, du nouveau vers l'ancien.
  for (const f of faits) {
    if (!f.remplaceId) continue;
    // Un remplacé absent de l'ensemble lu (supprimé, hors limite) ne produit pas de lien :
    // une extrémité manquante à l'écran ressemble à un défaut, pas à une information.
    if (!connus.has(f.remplaceId)) continue;
    liens.push({
      ...paire("remplacement", f.id, f.remplaceId),
      cibleB: "fait",
      type: "remplacement",
      poids: 1,
      regle: "remplacement",
      pourquoi: "Ce fait remplace l'autre : c'est la même chose a deux moments.",
    });
  }

  // 4. `meme-domaine-meme-entite` — même domaine, même valeur d'attribut normalisée.
  //    ⚠️ SEULS `emetteur` et `type` comptent. `annee` et `echeance` sont des DATES : deux
  //    documents de 2024 ne parlent pas de la même entité, et les inclure ferait de cette
  //    règle un doublon bruyant de `meme-periode`.
  for (const cle of ["emetteur", "type"] as const) {
    const groupes = grouper(faits, (f) => {
      const v = f.attributs?.[cle];
      return v ? JSON.stringify([f.domaine, normaliserAttribut(v)]) : null;
    });
    for (const [k, groupe] of groupes) {
      const domaine = (JSON.parse(k) as [string, string])[0];
      liens.push(
        ...cliqueBornee(
          groupe.map((f) => f.id),
          "meme-domaine-meme-entite",
          `${groupe.length} faits du domaine « ${domaine} » partagent le même ${cle}`,
          (a, b) => ({
            ...paire("meme-domaine-meme-entite", a, b),
            cibleB: "fait" as const,
            type: "meme-domaine-meme-entite" as const,
            poids: 0.8,
            regle: `meme-domaine-meme-entite:${cle}`,
            pourquoi: `Même domaine (${domaine}) et même ${cle}.`,
          }),
          abstentions,
        ),
      );
    }
  }

  // 5. `cause-declaree` — ORIENTÉ, du fait vers la question qui l'a produit.
  for (const q of questions) {
    if (!q.faitId || !connus.has(q.faitId)) continue;
    liens.push({
      faitA: q.faitId,
      faitB: q.id,
      cibleB: "question",
      type: "cause-declaree",
      poids: 1,
      regle: "cause-declaree",
      // La question est du texte que Marc a lu à l'écran, pas une valeur chiffrée.
      pourquoi: `Ce fait vient d'une question : « ${q.question.slice(0, 80)} »`,
    });
  }

  // Dédoublonnage par (faitA, faitB, type). L'index unique de la base dit la même chose, et
  // le faire ICI évite qu'une écriture entière échoue sur un doublon qu'on pouvait voir.
  const vus = new Set<string>();
  const uniques: LienCalcule[] = [];
  for (const l of liens) {
    if (l.faitA === l.faitB) continue;
    const k = JSON.stringify([l.faitA, l.faitB, l.type]);
    if (vus.has(k)) continue;
    vus.add(k);
    uniques.push(l);
  }
  return { liens: uniques, abstentions };
}

/** Regroupe pour l'écran : un type de lien, ses liens, triés par poids décroissant. */
export function parType(liens: readonly LienCalcule[]): { type: TypeLien; liens: LienCalcule[] }[] {
  const m = new Map<TypeLien, LienCalcule[]>();
  for (const l of liens) {
    const liste = m.get(l.type);
    if (liste) liste.push(l);
    else m.set(l.type, [l]);
  }
  return [...m.entries()]
    .map(([type, ls]) => ({ type, liens: [...ls].sort((x, y) => y.poids - x.poids) }))
    .sort((a, b) => b.liens.length - a.liens.length);
}
