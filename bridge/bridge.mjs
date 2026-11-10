// ============================================================
//  G0DM0D3 ⇄ OpenCode Bridge
//  Expose les modèles GRATUITS d'opencode via une API compatible
//  OpenAI, pour les brancher sur godmod3.ai (Local Models).
//  Sans dépendances — Node 18+
//  Lancer :  node bridge.mjs        (port 5791 par défaut)
// ============================================================

import http from "node:http";
import { spawn } from "node:child_process";

const PORT = Number(process.env.BRIDGE_PORT || 5791);
const REQUEST_TIMEOUT_MS = Number(process.env.BRIDGE_TIMEOUT_MS || 240_000);
const MAX_CONCURRENCY = Number(process.env.BRIDGE_MAX_CONCURRENCY || 6);
const IS_WIN = process.platform === "win32";
// Windows : `opencode` est un .cmd → il faut shell:true pour le trouver
const SPAWN_OPTS = { shell: IS_WIN, stdio: ["ignore", "pipe", "pipe"] };

// ------------------------------------------------------------
// Découverte des modèles gratuits
// ------------------------------------------------------------
const STATIC_FALLBACK = [
  "opencode/beam-free",
  "opencode/deepseek-v4.1-flash-free",
  "opencode/flint-40b-free",
  "opencode/glm-5.3-flash-free",
  "opencode/iceman-free",
  "opencode/inkling-2-small-free",
  "opencode/longcat-2.5-free",
  "opencode/mimo-v2.6-flash-free",
  "opencode/minimax-m3.1-flash-free",
  "opencode/nemotron-3.5-lightning-free",
  "opencode/nemotron-3.5-super-vl-free",
];

let FREE_MODELS = STATIC_FALLBACK;

async function discoverModels() {
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn("opencode", ["models"], SPAWN_OPTS);
      let s = "";
      p.stdout.on("data", (d) => (s += d));
      p.on("error", reject);
      p.on("close", () => resolve(s));
    });
    const found = out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("free"));
    if (found.length > 0) FREE_MODELS = found;
    console.log(`[bridge] ${FREE_MODELS.length} modèle(s) gratuit(s) découvert(s)`);
  } catch {
    console.log("[bridge] découverte impossible, liste de secours utilisée");
  }
}

// ------------------------------------------------------------
// Traduction messages OpenAI -> prompt -> `opencode run`
// ------------------------------------------------------------
function messagesToPrompt(messages) {
  const parts = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const role = m.role || "user";
    let content = m.content ?? "";
    if (Array.isArray(content)) {
      content = content
        .filter((c) => c && (c.type === "text" || typeof c === "string"))
        .map((c) => (typeof c === "string" ? c : c.text || ""))
        .join("\n");
    }
    if (typeof content !== "string" || content.trim() === "") continue;
    if (role === "system") parts.push(`[System]\n${content}`);
    else if (role === "assistant") parts.push(`[Assistant]\n${content}`);
    else if (role === "user") parts.push(`[User]\n${content}`);
  }
  return parts.join("\n\n---\n\n");
}

function runOpencode(model, prompt, onText) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "opencode",
      ["run", "-m", model, "--format", "json", "--pure", prompt],
      SPAWN_OPTS
    );

    let stdout = "";
    let stderr = "";
    let buffer = "";
    let text = "";
    const seenParts = new Set();

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timeout après ${REQUEST_TIMEOUT_MS / 1000}s`));
    }, REQUEST_TIMEOUT_MS);

    child.stdout.on("data", (d) => {
      buffer += d;
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === "text" && evt.part?.text != null && !seenParts.has(evt.part.id)) {
            seenParts.add(evt.part.id);
            const piece = evt.part.text;
            text = (text ? text + "\n" : "") + piece;
            if (onText) onText(piece);
          }
        } catch {
          /* ligne non-JSON ignorée */
        }
      }
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && text.trim() !== "") resolve(text.trim());
      else reject(new Error(stderr.trim() || `opencode a quitté (code ${code})`));
    });
  });
}

// ------------------------------------------------------------
// Petit limiteur de concurrence
// ------------------------------------------------------------
let running = 0;
const queue = [];
function acquire(fn) {
  if (running < MAX_CONCURRENCY) {
    running++;
    fn(() => {
      running--;
      const next = queue.shift();
      if (next) acquire(next[0]);
    });
  } else queue.push([fn]);
}

function compactCensoredList(list) {
  return list.map((id) => {
    const short = id.split("/").slice(-1)[0];
    return { id, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "opencode-bridge", bridge_display_name: short };
  });
}

// ------------------------------------------------------------
// Réponses SSE (streaming)
// ------------------------------------------------------------
function sseChunk(res, model, piece, finish) {
  const obj = {
    id: "chatcmpl-bridge",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: piece == null ? {} : { content: piece }, finish_reason: finish || null }],
  };
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
  if (finish) res.write("data: [DONE]\n\n");
}

// ------------------------------------------------------------
// Serveur HTTP
// ------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // CORS large : godmod3 hébergé ou auto-hébergé doit pouvoir appeler
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "");

  // --- Liste des modèles ---
  if (path === "/v1/models" || path === "/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ object: "list", data: compactCensoredList(FREE_MODELS) }));
  }

  // --- Santé ---
  if (path === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, models: FREE_MODELS.length }));
  }

  // --- Chat completions ---
  if ((path === "/v1/chat/completions" || path === "/chat/completions") && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let json;
      try {
        json = JSON.parse(body || "{}");
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "JSON invalide" } }));
      }

      const model = typeof json.model === "string" && json.model.trim() !== "" ? json.model : FREE_MODELS[0];
      const prompt = messagesToPrompt(json.messages || []);
      const wantsStream = json.stream === true;

      if (prompt.trim() === "") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "Aucun message utilisateur" } }));
      }

      acquire((done) => {
        console.log(`[bridge] -> ${model} (${prompt.length} car., stream=${wantsStream})`);
        const started = Date.now();

        if (wantsStream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
        }

        runOpencode(model, prompt, wantsStream ? (piece) => sseChunk(res, model, piece) : null)
          .then((text) => {
            console.log(`[bridge] <- ${model} ok (${((Date.now() - started) / 1000).toFixed(1)}s)`);
            if (wantsStream) {
              sseChunk(res, model, null, "stop");
              res.end();
            } else {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  id: "chatcmpl-bridge",
                  object: "chat.completion",
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
                  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                })
              );
            }
          })
          .catch((err) => {
            console.error(`[bridge] !! ${model} : ${err.message}`);
            if (wantsStream) {
              res.end();
            } else {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: { message: err.message, bridge_model: model } }));
            }
          })
          .finally(done);
      });
    });
    return;
  }

  // --- Racine /v1 : page d'info au lieu de 404 ---
  if (path === "/v1" || path === "") {
    const isJson = (req.headers.accept || "").includes("application/json");
    const info = {
      service: "G0DM0D3 ⇄ OpenCode Bridge",
      base_url_for_godmod3: `http://localhost:${PORT}/v1`,
      endpoints: [`GET  /v1/models`, `POST /v1/chat/completions`, `GET  /health`],
      models: FREE_MODELS.length,
    };
    if (isJson) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(info, null, 2));
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(
      `<h1>G0DM0D3 ⇄ OpenCode Bridge</h1>
       <p>Le pont fonctionne ✅ — <strong>${FREE_MODELS.length}</strong> modèles gratuits disponibles.</p>
       <p><strong>URL à entrer dans godmod3 (Settings → Local Models) :</strong>
          <code>http://localhost:${PORT}/v1</code></p>
       <ul>
         <li><a href="/v1/models">Liste des modèles (/v1/models)</a></li>
         <li><code>POST /v1/chat/completions</code> — utilisé par l'interface</li>
         <li><a href="/health">/health</a></li>
       </ul>`
    );
  }

  // --- Racine : petit résumé ---
  if (path === "/v2") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end("<h1>Utilisez /v1 — pas /v2</h1>");
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: `Route inconnue: ${path}` } }));
});

server.listen(PORT, "127.0.0.1", async () => {
  await discoverModels();
  console.log(`\n==========================================`);
  console.log(`  G0DM0D3 ⇄ OpenCode Bridge`);
  console.log(`  URL à entrer dans godmod3 (Local Models):`);
  console.log(`  ➜  http://localhost:${PORT}/v1`);
  console.log(`==========================================\n`);
});
