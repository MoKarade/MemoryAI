// lib/canari.ts — reconnaître une VALEUR qui ressemble à une consigne (ADR 0001 §3).
//
// Un fait dont la valeur dit « ignore les instructions précédentes » n'est pas un fait,
// c'est une tentative. On ne le refuse pas (le refus dirait à l'attaquant ce qui passe) :
// on le marque `canari`, il n'est JAMAIS servi à un modèle, et il apparaît dans « à
// valider » pour que Marc le voie. Ce module ne prétend pas détecter le SENS — une consigne
// en français courant peut passer — il attrape les FORMES connues, FR et EN, et c'est le
// balisage à la lecture qui fait le reste.
//
// Module PUR, motifs bilingues (leçon JobAI : une règle écrite dans une seule langue laisse
// l'autre entrer).

const MOTIFS: readonly RegExp[] = [
  // Impératifs adressés à un modèle.
  /\b(ignore|ignores|ignorez|oublie|oubliez|forget|disregard)\b.{0,40}\b(instruction|consigne|règle|regle|rule|prompt|précédent|precedent|previous|above)/i,
  /\b(new|nouvelles?)\s+(instructions?|consignes?|rules?)\b/i,
  /\b(you are|tu es|vous êtes|act as|agis comme|comporte-toi)\b.{0,30}\b(assistant|system|système|systeme|ai|model|modèle)/i,
  // Étiquettes de rôle et balises de prompt.
  /(^|\s)(system|assistant|user|human|système|systeme|utilisateur)\s*:/i,
  /<\/?\s*(system|assistant|user|human|donnees|fait|tool|instructions?)\b/i,
  /<\|[^|>]{0,40}\|>/,
  // Demandes d'action ou d'exfiltration.
  // ⚠️ `\b` est ASCII en JavaScript (leçon JobAI) : aucune frontière devant « à », donc le
  // motif s'ancre sur l'OBJET exfiltré, pas sur la préposition.
  /\b(envoie|envoyez|send|transmets|transfère|transfere|forward|exfiltr)\w*\b.{0,40}\b(faits|donn[ée]es|data|everything|tout|base|database|m[ée]moire|memory|secret|cl[ée]|key|token|jeton)/i,
  /\b(révèle|revele|reveal|affiche|print|dump)\b.{0,30}\b(clé|cle|key|secret|token|jeton|mot de passe|password)/i,
  /\b(exécute|execute|run|lance)\b.{0,20}\b(commande|command|script|code)\b/i,
  // Marqueurs de blocs de code ou de séparateurs de prompt.
  /```|~~~|^\s*#{1,3}\s*(system|instructions?)/im,
];

export function estCanari(valeur: string | null | undefined): boolean {
  if (!valeur) return false;
  return MOTIFS.some((m) => m.test(valeur));
}
