// app/chat/page.tsx — PARLER : la conversation complète avec Lia (historique, modèle, niveaux).
//
// [L26] Elle était l'accueil (`/`) depuis le 17/09. MemoryAI#74 (maquette v5, 23/10) rend la
// racine à la MAISON de LIA (l'orbite, `app/page.tsx`) : la conversation revient ici, à son
// ancienne adresse, entière. Toucher LIA ouvre aussi une discussion légère partout (`lia-ui`) ;
// celle-ci reste l'atelier : historique, choix du modèle, niveaux 2 et 3.
//
// ⚠️ `requireSession()` comme partout (`tests/gardePages.test.ts`). Plus aucune pastille
// « N à juger » nulle part : Marc ne juge plus rien (tâche MemoryAI 231).
//
// Ce que cette page NE fait pas encore (ADR 0005 §4 B1) : le bandeau « Ce qui s'en vient »
// (3 à 5 échéances). Aucune requête d'échéances n'existe dans ce dépôt — mesuré, zéro
// fonction — et l'inventer ici mélangerait la NAVIGATION avec une requête neuve. Il arrive
// avec L30, qui construit la frise et les échéances ensemble.

import { Nav } from "@/components/Nav";
import { ChatClient } from "./ChatClient";
import { MODELE_DEFAUT, MODELES, PLAFONDS_DEFAUT_USD_PAR_JOUR } from "@/lib/coutChat";
import { depotConversationsDrizzle } from "@/lib/conversations/depot";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { n2Autorise, n3Autorise } from "@/lib/lecture";
import { accesDonnees } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";
import { vocabulaire } from "@/lib/vocabulaire";

export const dynamic = "force-dynamic";

/**
 * ⚠️ `a-propos` vient d'un lien de fiche (« Demander à Lia là-dessus », [L33a]) et porte le
 * LIBELLÉ d'un fait, jamais sa valeur — un paramètre d'URL voyage dans l'historique du
 * navigateur et dans les journaux. Il est BORNÉ ici quand même : ce paramètre est écrivable
 * par n'importe qui dans la barre d'adresse, donc on le traite comme une entrée externe
 * (une seule valeur, tronquée). Il ne fait que PRÉREMPLIR le champ : rien n'est envoyé sans
 * un clic, donc une URL forgée ne peut pas dépenser d'appel payant.
 */
const MAX_SAISIE_INITIALE = 300;

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const configure = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const acces = await accesDonnees();
  // ⚠️ Le plafond AFFICHÉ doit être celui qui s'appliquera, pas le défaut du code : Marc le
  // règle dans l'app depuis [L34]. Sans base, on montre le défaut — c'est ce qui
  // s'appliquerait aussi, donc la phrase reste vraie.
  const plafondsEffectifs = acces.ok ? await depotAdminDrizzle(acces.db).plafonds() : PLAFONDS_DEFAUT_USD_PAR_JOUR;
  // [L2, ADR 0011] L'historique à gauche : les conversations du CHAT, avec leur premier
  // message pour titre. `null` quand la base manque — l'écran le dit, au lieu d'une liste vide
  // qui laisserait croire qu'aucune conversation n'a jamais été gardée.
  const historiqueInitial = acces.ok
    ? (await depotConversationsDrizzle(acces.db).apercus("memoryai", 30, acces.cle)).map((c) => ({
        id: c.id,
        quand: c.finLe.toISOString(),
        titre: c.titre,
        nbMessages: c.nbMessages,
      }))
    : null;
  const brut = (await searchParams)["a-propos"];
  const saisieInitiale = (Array.isArray(brut) ? brut[0] : brut)?.slice(0, MAX_SAISIE_INITIALE);

  return (
    <>
      <Nav active="chat" />
      <ChatClient
        modeles={MODELES.map((m) => ({ id: m.id, nom: m.nom }))}
        modeleDefaut={MODELE_DEFAUT}
        n2Possible={n2Autorise()}
        n3Possible={n3Autorise()}
        plafondUsd={plafondsEffectifs.chat}
        configure={configure}
        saisieInitiale={saisieInitiale}
        historiqueInitial={historiqueInitial}
        predicats={vocabulaire()
          .filter((p) => !p.deprecie)
          .map((p) => ({ predicat: p.predicat, description: p.description, types: [...p.types] }))}
      />
    </>
  );
}
