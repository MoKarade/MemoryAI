// lib/chat/couches.ts — lire la VOIX et le PROFIL de Marc pour un tour de chat. [L27]
//
// C'est la partie I/O ; tout ce qui décide est pur (`construireProfil`, `baliserVoix`,
// `construirePrompt`). Appelée UNE fois par tour, par la route.
//
// ⚠️ Le profil sort vers un modèle : il passe donc par le journal d'accès, comme tout fait servi
// (`outil: "profil"`, `lecteur: "chat"`). Servir sans journaliser est exactement ce que le journal
// existe pour empêcher ; si l'entrée ne peut PAS s'écrire, le profil est OMIS de ce tour — Lia
// répond sans — et l'échec est consigné, jamais avalé. La voix, elle, n'est pas un fait : rien à
// journaliser.

import type { Cle } from "../chiffrement";
import type { DepotAdmin } from "../depotAdmin";
import type { DepotLecture } from "../depotLecture";
import { cleJournalDepuisEnv } from "../journal";
import { journaliserAcces } from "../journalAcces";
import { rendreServables, type PolitiqueLecture } from "../lecture";
import { baliserProfil, construireProfil, PREDICATS_PROFIL } from "./profil";
import type { Couches } from "./prompt";
import { baliserVoix } from "./voix";

/** Le profil ne sert JAMAIS plus que N0/N1 validés : aucune bascule de conversation ne l'élargit. */
const POLITIQUE_PROFIL: PolitiqueLecture = {
  inclureN2: false,
  n2Autorise: false,
  inclureN3: false,
  n3Autorise: false,
  inclureProposes: false,
};

/** Les domaines à lire en base, dérivés de la liste blanche : une seule définition. */
const DOMAINES_PROFIL: readonly string[] = [...new Set(PREDICATS_PROFIL.map((p) => p.split(".")[0]!))];

/** Assez large pour tous les faits des domaines du profil, sans lire la table. */
const LIMITE_LECTURE = 500;

export async function chargerCouches(p: {
  lecture: DepotLecture;
  admin: Pick<DepotAdmin, "voixLia">;
  cle: Cle;
  env: Record<string, string | undefined>;
  maintenant: () => Date;
}): Promise<Couches> {
  const voix = baliserVoix(await p.admin.voixLia());

  const [rows, retenus] = await Promise.all([
    p.lecture.faits({ statuts: ["valide"], domaines: DOMAINES_PROFIL, limite: LIMITE_LECTURE }),
    p.lecture.predicatsRetenus(),
  ]);
  const { faits, illisibles } = rendreServables(rows, POLITIQUE_PROFIL, p.cle, retenus);
  // Un fait illisible est écarté (jamais rendu vide) ; on le DIT, comme partout ailleurs.
  if (illisibles > 0) console.error(`[chat] profil : ${illisibles} fait(s) illisible(s) écarté(s)`);
  const profil = construireProfil(faits, retenus);
  if (profil.ids.length === 0) return { voix, profil: null };

  try {
    const servis = faits.filter((f) => profil.ids.includes(f.id));
    await journaliserAcces(
      p.lecture,
      cleJournalDepuisEnv(p.env),
      {
        lecteur: "chat",
        outil: "profil",
        usage: "conversation",
        niveauMaxServi: Math.max(0, ...servis.map((f) => f.niveau)),
        idsFaits: profil.ids,
        questionEmpreinte: null,
      },
      p.maintenant,
    );
  } catch (err) {
    console.error("[chat] profil omis : l'accès n'a pas pu être journalisé", err);
    return { voix, profil: null };
  }
  return { voix, profil: baliserProfil(profil) };
}
