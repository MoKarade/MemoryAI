// app/page.tsx — [L26] PARLER : l'accueil, c'est Lia.
//
// ⚠️ La racine redirigeait vers `/moi` — un tableau de compteurs. Marc, le 17/09 : « 2 827 ne
// fait décider personne » (ADR 0004 n° 43), et « je veux que ce soit très simple à utiliser ».
// L'accueil devient donc la CONVERSATION, et les compteurs déménagent dans Régler → État.
//
// ⚠️⚠️ CETTE PAGE N'EST PLUS EXEMPTÉE de `tests/gardePages.test.ts`. Elle l'était parce qu'elle
// « redirige vers /moi sans rien lire » ; elle lit et affiche désormais, donc elle appelle
// `requireSession()` comme les autres. La garde a un contrôle ANTI-FANTÔME sur sa liste
// d'exemptions : laisser l'ancienne entrée aurait fait rougir le test plutôt que de passer en
// silence. C'est exactement ce qu'on attend d'une liste d'exceptions.
//
// Ce que cette page NE fait pas encore (ADR 0005 §4 B1) : le bandeau « Ce qui s'en vient »
// (3 à 5 échéances). Aucune requête d'échéances n'existe dans ce dépôt — mesuré, zéro
// fonction — et l'inventer ici mélangerait la NAVIGATION avec une requête neuve. Il arrive
// avec L30, qui construit la frise et les échéances ensemble.

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { ChatClient } from "./chat/ChatClient";
import { jourQuebec, MODELE_DEFAUT, MODELES, PLAFONDS_DEFAUT_USD_PAR_JOUR } from "@/lib/coutChat";
import { depotConversationsDrizzle } from "@/lib/conversations/depot";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { n2Autorise, n3Autorise } from "@/lib/lecture";
import { accesDonnees } from "@/lib/pageDonnees";
import { bandeauAJuger, type BandeauAJuger } from "@/lib/pile/bandeau";
import { chargerEntreesPile } from "@/lib/pile/charger";
import { composerPile, restantParGenre } from "@/lib/pile/composer";
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

export default async function ParlerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const configure = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const acces = await accesDonnees();
  // ⚠️ Un COMPTE, pas les cartes : l'accueil n'affiche pas la pile, il dit qu'elle a quelque
  // chose à juger. Charger les cartes ici les afficherait deux fois, une par surface. Le compte
  // vient de la PILE (MemoryAI#90) — avant, il ne comptait que les questions ouvertes, donc un
  // papier lu ou une déduction à juger ne faisaient jamais apparaître le lien vers `/questions`.
  // ⚠️ `avis` entre dans le compte : une carte déjà jugée n'est plus « à juger ».
  let aJuger: BandeauAJuger | null = null;
  if (acces.ok) {
    const { candidats, deductions, questions, avis } = await chargerEntreesPile(acces.db);
    const ordre = composerPile({
      pieces: candidats,
      faits: deductions.map((d) => ({ id: d.fait.id, creeLe: d.fait.creeLe })),
      questions: questions.map((q) => ({ id: q.id, creeLe: q.creeLe })),
      avis,
      aujourdhui: jourQuebec(new Date()),
    });
    aJuger = bandeauAJuger(restantParGenre(ordre, avis));
  }
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
      <Nav active="parler" />
      {/* ⚠️ REPLIÉ par défaut (`<details>` sans `open`) : « des informations cachées en
          cliquant sur certains boutons » (Marc, 17/09). Et il ne s'affiche QUE s'il y a
          quelque chose à faire — un bandeau permanent qui dit « 0 à juger » est du décor
          qu'on cesse de lire, comme un avertissement permanent. */}
      {aJuger && (
        <details className="repli repli-accueil">
          <summary>{aJuger.titre}</summary>
          <p className="hint">
            {aJuger.detail}. Juger une carte (vrai, faux ou passer) corrige la mémoire sans que tu aies à raconter ta vie.
          </p>
          <Link href="/questions" className="bouton bouton-second">
            Voir la pile
          </Link>
        </details>
      )}
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
