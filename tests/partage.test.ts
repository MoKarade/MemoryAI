// tests/partage.test.ts — le partage Android, et le PIÈGE qui a coûté une session à BatchChef.
//
// Deux choses se prouvent ici, et aucune ne se déduit du code :
//
//  1. `doitIntercepterPartage` exige `mode === "navigate"`. Sans ce test, une Server Action
//     POSTée vers `/partage` serait avalée par le service worker, qui répondrait une
//     redirection 303 à la place du résultat — « An unexpected response was received from the
//     server », et des journaux serveur VIDES puisque la réponse vient du téléphone ;
//  2. les constantes du worker et celles de `lib/partage.ts` sont IDENTIQUES. Un service
//     worker ne peut rien importer : la divergence casserait le partage EN SILENCE, la page
//     ne trouvant simplement rien dans le cache. C'est un tripwire, pas une relecture.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  brouillonDepuisPartage,
  CACHE_PARTAGE,
  CHEMIN_PARTAGE,
  CLE_META,
  doitIntercepterPartage,
  LONGUEUR_MAX_PARTAGE,
  normaliserPartage,
} from "../lib/partage";

const SW = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

describe("ce que le service worker intercepte", () => {
  const nav = { method: "POST", pathname: CHEMIN_PARTAGE, mode: "navigate" };

  it("le partage Android, et LUI SEUL", () => {
    expect(doitIntercepterPartage(nav)).toBe(true);
    expect(doitIntercepterPartage({ ...nav, method: "GET" })).toBe(false);
    expect(doitIntercepterPartage({ ...nav, pathname: "/chat" })).toBe(false);
  });

  it("⚠️ une Server Action POSTée vers /partage n'est PAS interceptée", () => {
    // Le cas qui a coûté une session entière à BatchChef le 13/08/2026. Une Server Action de
    // Next POSTe vers l'URL de la PAGE COURANTE : depuis `/partage`, elle vise `/partage`.
    // Seul `mode` les distingue — un partage est une NAVIGATION, un `fetch()` non.
    for (const mode of ["cors", "same-origin", "no-cors"]) {
      expect(doitIntercepterPartage({ ...nav, mode }), mode).toBe(false);
    }
  });

  it("le worker DÉPLOYÉ applique les trois mêmes conditions", () => {
    // Le test précédent éprouve la fonction PURE ; celui-ci éprouve le fichier qui tourne
    // vraiment. Sans lui, la fonction pourrait être juste et le worker faux.
    expect(SW).toContain('event.request.method !== "POST"');
    expect(SW).toContain(`url.pathname !== "${CHEMIN_PARTAGE}"`);
    expect(SW).toContain('event.request.mode !== "navigate"');
  });

  it("les constantes du worker et du module sont IDENTIQUES (tripwire)", () => {
    expect(SW).toContain(`const CACHE_PARTAGE = "${CACHE_PARTAGE}";`);
    expect(SW).toContain(`const CLE_META = "${CLE_META}";`);
  });

  it("le worker ne met RIEN en cache d'autre que le partage", () => {
    // ⚠️ MemoryAI sert les données les plus personnelles de l'écosystème derrière une session.
    // Un worker qui mettrait des pages en cache les laisserait sur l'appareil et en servirait
    // des périmées à quelqu'un qui n'a plus de session. La garde vise les APPELS, pas la prose.
    const code = SW.replace(/\/\/[^\n]*/g, "");
    expect(code.match(/cache\.put\(/g) ?? []).toHaveLength(1);
    expect(code).not.toContain("cache.addAll");
    expect(code).not.toContain("caches.match(");
  });
});

describe("démêler ce qu'Android envoie", () => {
  it("le champ `url` dédié quand l'app source le remplit", () => {
    const r = normaliserPartage({ titre: "Un bail", texte: "à relire", url: "https://exemple.ca/a" });
    expect(r.lien).toBe("https://exemple.ca/a");
    expect(r.description).toBe("Un bail\nà relire");
  });

  it("une URL NOYÉE dans le texte en est extraite, et le reste du texte est gardé", () => {
    const r = normaliserPartage({ texte: "regarde ça https://exemple.ca/b c'est important" });
    expect(r.lien).toBe("https://exemple.ca/b");
    // ⚠️ Deux espaces là où le lien a été retiré, et c'est VOULU : recoller les mots
    // fabriquerait du texte que Marc n'a pas écrit. Le trou dit où était le lien.
    expect(r.description).toBe("regarde ça  c'est important");
  });

  it("aucun lien : tout le texte reste", () => {
    const r = normaliserPartage({ titre: "Note", texte: "penser au renouvellement" });
    expect(r.lien).toBeNull();
    expect(r.description).toBe("Note\npenser au renouvellement");
  });

  it("un schéma qui n'est pas http(s) n'est JAMAIS retenu comme lien", () => {
    // Même garde que côté serveur : un `javascript:` ou un `file:` rendu cliquable serait une
    // porte ouverte sur l'appareil de Marc.
    for (const mauvais of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x"]) {
      expect(normaliserPartage({ url: mauvais }).lien, mauvais).toBeNull();
    }
  });

  it("le titre qui répète le texte n'est pas collé deux fois", () => {
    const r = normaliserPartage({ titre: "bail", texte: "mon bail finit en juin" });
    expect(r.description).toBe("mon bail finit en juin");
  });

  it("le brouillon REMET le lien à la fin, et il est borné", () => {
    // Sans cette remise, le lien serait perdu : `description` l'a justement sorti du texte.
    const b = brouillonDepuisPartage({ lien: "https://exemple.ca/c", description: "à retenir" });
    expect(b).toBe("à retenir\nhttps://exemple.ca/c");
    const long = brouillonDepuisPartage({ lien: null, description: "x".repeat(LONGUEUR_MAX_PARTAGE + 500) });
    expect(long).toHaveLength(LONGUEUR_MAX_PARTAGE);
  });
});

describe("le manifeste", () => {
  it("ne déclare AUCUN fichier en partage, et c'est une décision", async () => {
    // ⚠️ Partager un document ici reviendrait à faire ingérer un papier par MemoryAI — c'est
    // le travail de DriveAI, et c'est par lui que passe la frontière de l'ADR-0061. Un second
    // chemin d'entrée créerait une source de vérité que personne ne penserait à fermer.
    const { default: manifest } = await import("../app/manifest");
    const m = manifest();
    expect(m.share_target?.params).toEqual({ title: "title", text: "text", url: "url" });
    expect(JSON.stringify(m.share_target)).not.toContain("files");
    // POST : en GET, Android mettrait le texte PERSONNEL dans l'URL — donc dans l'historique.
    expect(m.share_target?.method).toBe("POST");
    expect(m.share_target?.action).toBe(CHEMIN_PARTAGE);
    // ⚠⚠ CETTE ASSERTION DISAIT `"/moi"`, ET ELLE CERTIFIAIT UN DÉFAUT. Elle est restée
    // verte pendant que L26a déplaçait l'accueil vers la conversation, puis que L26b faisait
    // de `/moi` la seule page de PURGE : lancer l'app installée ouvrait « Effacer toute la
    // mémoire ». Une garde qui épingle une VALEUR ne peut pas voir que cette valeur a cessé
    // de désigner la bonne chose — elle se périme en silence, et elle compte quand même comme
    // protection dans tout inventaire.
    //
    // Inversée AU MÊME ENDROIT plutôt que supprimée (règle du dépôt), et ancrée sur le FAIT :
    // le point d'entrée de l'app installée est la première section de la barre. Ce que ça
    // interdit, c'est qu'un lot déplace l'accueil sans emmener le manifeste.
    const { SECTIONS } = await import("../components/Nav");
    expect(m.start_url).toBe(SECTIONS[0]!.href);
    // Et l'anti-vacuité qui manquait : que `start_url` désigne la CONVERSATION, pas une page
    // de réglage. Sans elle, l'égalité ci-dessus serait satisfaite par une barre dont la
    // première entrée serait redevenue `/moi`.
    expect(m.start_url).toBe("/");
  });
});
