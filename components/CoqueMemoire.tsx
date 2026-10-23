// components/CoqueMemoire.tsx — la coque de la page Mémoire (maquette v5, `.vue`) : une vue plein
// écran, un retour vers LIA, le logo, « Mémoire », et les onglets segmentés à icônes. Chaque onglet
// est une page rendue au serveur avec ses propres lectures : des liens, pas un état client.
//
// ⚠️ Pas de menu de l'app ici, comme la maquette : on revient à LIA par le retour, et de là partout.

import Link from "next/link";
import { IconeEspace, type NomIcone } from "./IconeEspace";
import { LogoMemoire } from "./LogoMemoire";

export const ONGLETS_MEMOIRE = [
  { cle: "memoire", href: "/memoire", libelle: "Mémoire", icone: "db" },
  { cle: "reseau", href: "/memoire/reseau", libelle: "Réseau", icone: "net" },
  { cle: "apprentissage", href: "/memoire/apprentissage", libelle: "Apprentissage", icone: "target" },
  { cle: "historique", href: "/memoire/historique", libelle: "Historique", icone: "hist" },
  { cle: "acces", href: "/memoire/acces", libelle: "Accès", icone: "lock" },
] as const satisfies readonly { cle: string; href: string; libelle: string; icone: NomIcone }[];

type OngletMemoire = (typeof ONGLETS_MEMOIRE)[number]["cle"];

export function CoqueMemoire({ actif, children }: { actif: OngletMemoire; children: React.ReactNode }) {
  return (
    <div className="coque-memoire">
      <header className="coque-memoire-tete">
        <Link href="/" className="bouton-rond" aria-label="Retour à LIA">
          <IconeEspace nom="back" taille={20} />
        </Link>
        <h1>
          <LogoMemoire />
          Mémoire
        </h1>
        <nav className="onglets-seg" aria-label="Sections de la mémoire">
          {ONGLETS_MEMOIRE.map((o) => (
            <Link key={o.cle} href={o.href} aria-label={o.libelle} aria-current={o.cle === actif ? "page" : undefined}>
              <IconeEspace nom={o.icone} taille={16} />
              <span>{o.libelle}</span>
            </Link>
          ))}
        </nav>
      </header>
      <main className="coque-memoire-corps">{children}</main>
    </div>
  );
}
