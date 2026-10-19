<!-- Extrait de l'ancien CLAUDE.md (8. Documentation (où vit quoi)), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# 8. Documentation (où vit quoi)

| Fichier | Contenu |
|---|---|
| `README.md` | À quoi sert l'app, pour un lecteur extérieur. |
| `CLAUDE.md` | Ce fichier. Court. |
| `HANDOVER.md` | L'état RÉEL et ce qui attend un geste de Marc. À lire en premier. |
| `BACKLOG.md` | Les lots de la phase 0 et leur état ; ce qui vient après. |
| `docs/REFONTE-INTERFACE.md` | Le brief de la refonte de l'interface (25/09) : cadrage de Marc, interface mesurée, architecture et plan proposés. |
| `docs/A_FAIRE_MOI.md` | Ce que SEUL Marc peut faire (secrets, déploiements Apps Script), avec ce que chaque geste DÉBLOQUE. C'est là que Claude route ce qu'il ne peut pas faire, au lieu de le répéter en chat. |
| `docs/adr/` | Décisions architecturales, `NNNN-slug.md`. L'ADR 0001 porte la frontière, les garde-fous, les 21 décisions du 15/09 et le plan de la phase 0 ; l'ADR 0002 (**accepté**) amende cette frontière pour le texte des conversations et cadre la phase 1 ; l'ADR 0003 (**accepté**) amende le statut par défaut pour les faits mécaniques. L'ADR 0004 (**accepté**) ouvre la frontière au CONTENU des documents (numéros d'identité compris, pour Marc **et ses proches**), crée la table `pieces`, fait GRANDIR le vocabulaire sous quarantaine, et porte les 60 décisions de cadrage du 16/09. L'ADR 0005 (**proposé**, 17/09) : Lia parle juste (liens garantis par post-traitement, profil, voix éditable) et l'interface s'efface (4 onglets, graphe retiré, frise) — attend le Go de Marc. L'ADR 0006 (**accepté**) dit ce qui autorise un remplacement et ce que devient l'ancien ; l'ADR 0007 (**accepté**) ouvre le contenu des papiers d'identité sous deux verrous ; l'ADR 0008 (**accepté**, 21/09) **AMENDE** le §2 de 0006 — un rang strictement supérieur de `LIGNEE_EXTRACTEURS` remplace, ce qui rend enfin rattrapable un papier lu sous un prompt plus pauvre. L'ADR 0009 (**accepté**, 23/09) : DriveAI pousse des COMPTES à `POST /api/avancement` — jamais un fait, jamais servis à un modèle — pour l'onglet Avancement. L'ADR 0010 (**accepté**, 24/09) : rang 3 de la lignée, `sonnet-5-vision-piece-v3` — le modèle lit l'IMAGE du papier et en tire tout ; résumé 1 500 car., 80 champs libres (plafonds gardés par test). L'ADR 0011 (**accepté**, 24/09) : le niveau 3 n'est lu que par le chat (liste blanche de lecteurs, MCP fermé), ouvert par défaut ; plein texte N3 en mémoire ; historique du chat. L'ADR 0012 (**accepté**, 24/09) : la pile « vrai / faux » — une carte à la fois (papiers lus, déductions, questions), avis en AJOUT SEUL dans `avis_pile`, un papier contesté reste servi et marqué. |

⚠️ **Doc périmée = pire que pas de doc.** Mettre à jour la doc touchée dans la MÊME PR que le
code. ⚠️ **Un chiffre au présent rote** : le dater, ou renvoyer à la source qui fait foi.
