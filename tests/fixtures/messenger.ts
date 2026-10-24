// tests/fixtures/messenger.ts — un export Messenger FICTIF, de la forme relevée sur de vrais exports
// (ADR 0020). Noms, fil et textes inventés : aucune donnée de Marc.

export interface MessageFictif {
  auteur: string;
  date: string;
  texte?: string;
  photo?: boolean;
  reactions?: string[];
}

const section = (m: MessageFictif, i: number): string =>
  `<section class="_a6-g" aria-labelledby="u_${i}"><h2 class="_2ph_ _a6-h _a6-i" id="u_${i}">${m.auteur}</h2>` +
  `<div class="_2ph_ _a6-p"><div><div></div><div>${m.texte ?? ""}</div><div></div><div></div>` +
  (m.photo ? `<div><div><a target="_blank" href="your_facebook_activity/messages/inbox/fil_1/photos/1.jpg"><img src="x.jpg" class="_a6_o" /></a><div></div></div></div>` : "") +
  (m.reactions ? `<div><ul class="_a6-q">${m.reactions.map((r) => `<li><span>❤${r}</span></li>`).join("")}</ul></div>` : "") +
  `</div></div><footer class="_3-94 _a6-o"><div class="_a72d">${m.date}</div></footer></section>`;

/** Les messages sont donnés du plus RÉCENT au plus ancien, comme l'export les écrit. */
export function exportFictif(opts: { fil?: string; titulaire?: string; participants?: string[]; messages: MessageFictif[] }): string {
  const titulaire = opts.titulaire ?? "Paul Exemple";
  return (
    `<html><head><meta charset="UTF-8" /><style>body{color:#1c1e21}</style><title>${opts.fil ?? "Fil"}</title></head>` +
    `<body><div class="_li"><header><div class="_a70d"><h1 id="u_t">${opts.fil ?? "Fil"}</h1>` +
    `<aside role="contentinfo" class="_aoaa">Générée par ${titulaire} le <time datetime="2026-03-18T14:52Z">Le Mercredi 18 mars 2026 à 10:52 UTC-04:00</time></aside></div></header>` +
    `<main class="_a706" role="main">` +
    (opts.participants ? `<section class="_a6-g"><h2 class="_2ph_ _a6-h">Participants : ${opts.participants.join(", ").replace(/, ([^,]*)$/, " et $1")}</h2></section>` : "") +
    `<section class="_a6-g"><h2 class="_2ph_ _a6-h">Lien d’invitation au groupe : désactivé</h2></section>` +
    opts.messages.map(section).join("") +
    `</main></div></body></html>`
  );
}
