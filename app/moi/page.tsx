// app/moi/page.tsx — [L26b] cette page ne porte plus QUE la purge.
//
// Elle affichait sept tuiles de compteurs plus la zone rouge. Les compteurs ont déménagé dans
// **Régler → État**, où ils étaient déjà à moitié : cette page-là fetchait 4 des 5 lectures de
// celle-ci depuis L26a, pour n'en afficher qu'un nombre.
//
// ⚠️ LA PURGE, ELLE, N'A PAS DÉMÉNAGÉ, ET C'EST LE POINT. Le ticket L26 demande « purge plus
// difficile ». La mettre dans un dépli du hub la rendrait plus FACILE — un geste qui efface
// tous les faits ne doit pas se trouver sur le chemin de quelqu'un qui règle un périmètre. Elle
// garde donc sa page, atteinte par un lien qui dit ce qu'elle fait (« Effacer toute la
// mémoire… »), et non par un onglet.
//
// ⚠️ Pourquoi la page SURVIT au lieu de rediriger comme `/chat` : elle a encore un contenu à
// elle. Une redirection ici enverrait Marc sur un hub où le geste qu'il cherchait n'existe pas.
//
// ⚠️ Le mot de confirmation est exigé **côté serveur** (`purgerAction`), pas seulement par le
// `pattern` du formulaire : une Server Action est atteignable sans la page. Le `pattern` est
// une politesse, la vérification est ailleurs — et c'est elle qui protège.

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { MOT_DE_PURGE } from "@/lib/depotAdmin";
import { estGele } from "@/lib/gel";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";
import { purgerAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PurgePage() {
  await requireSession();
  const acces = await accesDonnees();
  const gele = estGele();

  return (
    <>
      <Nav active="moi" />
      <main className="page">
        <h1>Effacer toute la mémoire</h1>
        <p className="lead">
          Ce geste est irréversible. Il vit sur sa propre page — pas dans un dépli de Régler — parce qu’il ne doit pas se
          trouver sur le chemin de quelqu’un qui venait régler autre chose.
        </p>
        {gele && (
          <p className="alerte bandeau">
            Mémoire gelée (<code>MEMORYAI_GEL=1</code>) : rien n’est servi ni écrit par les machines. Cette page reste lisible.
          </p>
        )}
        {!acces.ok && <p className="alerte bandeau">{MESSAGES_MANQUE[acces.manque]}</p>}

        {acces.ok && (
          <section className="carte tuile zone-rouge" aria-labelledby="purge">
            <h2 id="purge">Tout effacer</h2>
            <p className="hint">
              Supprime tous les faits et leurs provenances. Les oublis et le journal d’accès restent — un fait oublié ne
              revient pas, même après une purge. Pour confirmer, tape le mot <code>{MOT_DE_PURGE}</code>.
            </p>
            <form action={purgerAction} className="ligne">
              <label htmlFor="confirmation" className="sr-only">
                Mot de confirmation
              </label>
              <input id="confirmation" className="champ" name="confirmation" type="text" autoComplete="off" placeholder={MOT_DE_PURGE} required pattern={MOT_DE_PURGE} />
              <button type="submit" className="bouton bouton-danger">
                Purger
              </button>
            </form>
          </section>
        )}

        <p className="hint">
          Les compteurs, les dépenses et le vocabulaire sont dans <Link href="/regler">Régler → État</Link>.
        </p>
      </main>
    </>
  );
}
