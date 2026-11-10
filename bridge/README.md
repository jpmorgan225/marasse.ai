# G0DM0D3 ⇄ OpenCode Bridge

Utilisez les **modèles 100 % gratuits** d'opencode comme moteurs derrière
**godmod3.ai** — zéro clé API, zéro abonnement OpenRouter.

Un mini-serveur sans dépendances (Node 18+) qui expose une API compatible
OpenAI, et joue le rôle d'interprète : chaque requête de godmod3 est
traduite en `opencode run -m <modèle>`.

---

## 🌍 Pour n'importe quel utilisateur (un commando)

Chaque personne qui possède un compte opencode installe le pont chez elle
(5 minutes, 2 commandes) — elle consomme alors **son propre quota gratuit**,
jamais celui de quelqu'un d'autre :

```bash
# télécharger le dossier du pont (ou cloner ce repo), puis :
cd godmod3-opencode-bridge
bash install.sh
```

L'installateur vérifie `node` + `opencode`, copie `bridge.mjs` vers
`~/.godmod3-bridge/`, active le lancement automatique (launchd macOS /
systemd Linux) et affiche l'URL à coller dans godmod3.

Puis sur **godmod3.ai** (ou votre fork auto-hébergé) :

1. **Settings → API Keys → Local Models**
2. URL : `http://localhost:5791/v1`
3. **Test & Discover Models** → les modèles gratuits apparaissent
4. Activer **Local-only mode** (coupe la télémétrie de l'app)

> 💡 Astuce navigateurs : la page `https://godmod3.ai` appelle un serveur
> local HTTP — Chrome/Firefox autorisent `localhost`, **Safari bloque**
> (mixed content). En cas de souci, auto-hébergez l'UI (option B ci-dessous).

## 🏠 Voie A — Fork auto-hébergé de godmod3 (recommandé)

Vous ne pouvez pas modifier le site godmod3.ai (il appartient à Pliny),
mais le projet est **AGPL-3.0** : le fork libre est encouragé.

```bash
git clone https://github.com/elder-plinius/G0DM0D3.git godmod3-opencode
cd godmod3-opencode
# personnalisez index.html (branding, preset "OpenCode Bridge" coché par défaut…)
# puis déployez gratuitement :
#  - Cloudflare Pages  (1 fichier, wrangler.toml déjà fourni)
#  - GitHub Pages / Vercel / Netlify
python3 -m http.server 8000   # test local : http://localhost:8000
```

⚠️ **Clause AGPL** : si vous mettez votre fork en ligne pour des utilisateurs,
vous devez leur proposer le code source modifié (Garder votre repo public).

## 📮 Voie B — PR vers le dépôt officiel

Pour « appliquer la mise à jour sur godmod3.ai », la bonne démarche
communautaire est une Pull Request vers
[`elder-plinius/G0DM0D3`](https://github.com/elder-plinius/G0DM0D3) :
un preset **« OpenCode Bridge »** dans Settings (URL par défaut
`http://localhost:5791/v1`) + un paragraphe au README. S'il est accepté,
tous les utilisateurs de godmod3.ai auront l'option en un clic.

---

## Variables optionnelles

| Variable | Défaut | Rôle |
|---|---|---|
| `BRIDGE_PORT` | 5791 | port d'écoute |
| `BRIDGE_TIMEOUT_MS` | 240000 | timeout par appel |
| `BRIDGE_MAX_CONCURRENCY` | 6 | appels opencode en parallèle |

## Modèles disponibles

Découverts automatiquement au démarrage (filtre : contient « free »),
liste de secours intégrée DOM si `opencode models` échoue.

## ⚠️ Notes

- Les modèles `opencode/*-free` fonctionnent avec un simple compte opencode ;
  les `openrouter/…:free` requièrent une auth OpenRouter déjà configurée
  dans opencode (`opencode auth`).
- Parallélisme limité (6) — augmentez `BRIDGE_MAX_CONCURRENCY` si besoin.
- Logs dans le terminal du pont (ou `~/.godmod3-bridge/server.log`).
- Comptes utilisateurs : le pont écoute sur `127.0.0.1` uniquement. Ne le
  mettez **pas** sur un VPS public : chaque utilisateur doit faire tourner
  son pont avec son propre compte, sinon c'est le quota de l'opérateur qui
  est partagé (et ignorerait les règles d'usage de son compte).
