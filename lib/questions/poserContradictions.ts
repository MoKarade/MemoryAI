// lib/questions/poserContradictions.ts — poser les questions que les CONTRADICTIONS dictent.
//
// La détection est pure (`contradictions.ts`) ; ici il n'y a que l'I/O : lire ce qui est déjà
// demandé, poser ce qui ne l'est pas, compter.
//
// ⚠️ AUCUN APPEL DE MODÈLE, ET C'EST STRUCTURANT. Ces questions se composent à partir de
// l'état de la base, en français, sans LLM — elles ne coûtent donc RIEN. Conséquence qu'il
// faut écrire pour qu'aucune refacto ne l'annule : elles doivent être posées **même quand le
// budget du jour est épuisé**. Les mettre derrière le même garde-budget que le producteur de
// questions par modèle serait une erreur de catégorie, et elle aurait un coût réel — une
// divergence sur une date de bail attendrait le lendemain pour une raison qui ne la concerne
// pas.
//
// ⚠️ Le plafond de cinq ouvertes, lui, s'applique : c'est `depotQuestions.poser` qui le tient
// (la garde qui décide est celle que le point d'écriture consulte). Une contradiction écartée
// par le plafond sera re-détectée à la passe suivante, puisqu'elle vient de l'ÉTAT et non d'un
// événement — c'est la différence avec une question de modèle, qu'on ne saurait pas reproduire.

import { definition, vocabulaire } from "../vocabulaire";
import type { DepotQuestions } from "../depotQuestions";
import { questionDeContradiction } from "../questions";
import { contradictions, doublonsExacts, type ContradictionDetectee, type FaitEnConflit } from "./contradictions";

export interface ResultatContradictions {
  /** Combien de contradictions l'état porte, qu'elles aient été posées ou non. */
  detectees: number;
  posees: number;
  /** Déjà demandées : une question ouverte existe pour ce prédicat. */
  dejaDemandees: number;
  /** Refusées par le plafond de cinq ouvertes — re-détectées à la passe suivante. */
  auPlafond: number;
}

/**
 * Les prédicats qui n'admettent qu'UNE valeur, dérivés du vocabulaire.
 *
 * ⚠️ Dérivé, jamais recopié : une liste écrite à la main ici divergerait du vocabulaire au
 * premier prédicat ajouté, et le sens de la divergence serait le mauvais — un prédicat
 * non-multi absent de la liste laisse sa contradiction invisible.
 */
export function predicatsAUneValeur(): ReadonlySet<string> {
  return new Set(vocabulaire().filter((p) => !p.multi).map((p) => p.predicat));
}

export async function poserContradictions(params: {
  faits: readonly FaitEnConflit[];
  questions: DepotQuestions;
  maintenant: () => Date;
}): Promise<ResultatContradictions> {
  // ⚠️ DEUX détecteurs, et leurs filtres sont EXACTEMENT INVERSES : `contradictions` ne
  // regarde que les prédicats à valeur unique (deux valeurs différentes = un choix à faire),
  // `doublonsExacts` que les prédicats multiples (la même valeur deux fois = un doublon à
  // retirer). Aucun prédicat ne peut donc produire deux questions concurrentes, et aucun
  // n'échappe aux deux. Un test garde cette partition — c'est elle qui rend le raisonnement
  // vérifiable plutôt que plausible.
  const aUneValeur = predicatsAUneValeur();
  const trouvees: ContradictionDetectee[] = [
    ...contradictions(params.faits, aUneValeur),
    ...doublonsExacts(params.faits, aUneValeur),
  ];
  const res: ResultatContradictions = { detectees: trouvees.length, posees: 0, dejaDemandees: 0, auPlafond: 0 };
  if (trouvees.length === 0) return res;

  const deja = await params.questions.predicatsDejaDemandes();
  for (const c of trouvees) {
    if (deja.has(c.predicat)) {
      res.dejaDemandees++;
      continue;
    }
    // ⚠️ Une sécurité de plus, et elle n'est pas redondante : `questionDeContradiction` ne
    // passe pas par `validerQuestion`, donc rien n'a vérifié que le prédicat existe encore
    // au vocabulaire courant. Un fait écrit sous une version antérieure peut porter un
    // prédicat retiré depuis — poser une question dessus ferait perdre son temps à Marc pour
    // un choix qui ne peut plus produire aucun fait servi.
    if (!definition(c.predicat)) continue;
    const pose = await params.questions.poser(questionDeContradiction(c), params.maintenant());
    if (pose.etat === "posee") res.posees++;
    else res.dejaDemandees++;
  }
  // Ce que le plafond a mangé se DÉDUIT, il ne se devine pas : `poser` écarte la plus ancienne
  // après insertion, donc une question posée peut être immédiatement écartée. Le compte utile
  // pour Marc reste « combien en attendent-elles », que la page affiche déjà.
  res.auPlafond = Math.max(0, res.detectees - res.posees - res.dejaDemandees);
  return res;
}
