// /api/user-following.js
import axios from "axios";

const RAPID_HOST = "cybrix-bytedance1.p.rapidapi.com";
const BASE = `https://${RAPID_HOST}`;

// caminhos prováveis
const CANDIDATE_PATHS = [
  "/scraping/user/followings",
  "/scraping/user/following",
  "/scraping/user/followers",
  "/scraping/user/follows",
  "/scraping/user/following/list",
  "/scraping/user/followList",
  "/user/followings",
  "/user/followers"
];

function normalizeEntry(e) {
  return {
    id: e?.id || e?.user_id || e?.uid || e?.userId || null,
    uniqueId: e?.uniqueId || e?.unique_id || e?.unique || null,
    nickname: e?.nickname || e?.nick || e?.name || "",
    avatar: e?.avatar || e?.avatar_medium || e?.avatar_thumb || null
  };
}

async function doPostJson(url, key, body) {
  try {
    const r = await axios.post(url, body, {
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": RAPID_HOST,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      timeout: 10000
    });

    // 🔹 Log detalhado no console (visível na Vercel)
    console.log(`[OK] ${url}`);
    console.log(`Status: ${r.status}`);
    console.log("Response snippet:", JSON.stringify(r.data)?.substring(0, 500));

    return { ok: true, status: r.status, data: r.data };
  } catch (err) {
    console.log(`[ERRO] ${url}`);
    console.log("Status:", err.response?.status);
    console.log("Mensagem:", err.response?.data || err.message);

    return {
      ok: false,
      status: err.response?.status,
      data: err.response?.data || err.message
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    console.log("[user-following] Método inválido:", req.method);
    return res.status(405).json({ error: "Método não permitido. Use GET ?userId=..." });
  }

  const { userId } = req.query;
  if (!userId) {
    console.log("[user-following] Parâmetro ausente: userId");
    return res.status(400).json({ error: "Parâmetro 'userId' é obrigatório." });
  }

  const key = process.env.RAPIDAPI_KEY || process.env.rapidapi_key;
  if (!key) {
    console.error("[user-following] ❌ RAPIDAPI_KEY não configurada no ambiente Vercel.");
    return res.status(500).json({ error: "RAPIDAPI_KEY não configurada." });
  }

  console.log(`[user-following] Iniciando consultas para userId=${userId}`);

  const attempts = [];

  for (const path of CANDIDATE_PATHS) {
    const url = BASE + path;
    console.log(`[Tentando] ${url}`);

    const attempt = await doPostJson(url, key, { username: String(userId) });
    attempts.push({ path, result: attempt });

    if (attempt.ok && attempt.status === 200 && attempt.data) {
      const payload = attempt.data;
      console.log(`[Sucesso] Path encontrado: ${path}`);

      // tenta extrair a lista
      let list =
        payload?.data?.list ||
        payload?.data?.followings ||
        payload?.data?.following ||
        payload?.data?.followers ||
        payload?.data ||
        payload?.followings ||
        payload?.following;

      if (!Array.isArray(list) && typeof list === "object") {
        const v = Object.values(payload.data || {}).find((val) => Array.isArray(val));
        if (Array.isArray(v)) list = v;
      }
      if (!Array.isArray(list) && Array.isArray(payload?.data?.users)) list = payload.data.users;

      if (!Array.isArray(list)) {
        console.log("[Aviso] Resposta recebida, mas sem lista detectada:");
        console.log(JSON.stringify(payload)?.substring(0, 500));

        return res.status(200).json({
          success: true,
          provider_status: attempt.status,
          provider_raw: payload,
          note: "Resposta recebida, mas não foi possível extrair lista automaticamente. Veja provider_raw."
        });
      }

      const normalized = list.map(normalizeEntry);
      console.log(`[Finalizado] ${normalized.length} followings encontrados em ${path}`);

      return res.status(200).json({
        success: true,
        provider_status: attempt.status,
        path,
        total: normalized.length,
        followings: normalized
      });
    }
  }

  console.error("[user-following] ❌ Nenhum endpoint retornou sucesso.");
  console.log("Tentativas:", JSON.stringify(attempts, null, 2)?.substring(0, 1500));

  return res.status(502).json({
    error: "Não foi possível consultar followings em nenhum endpoint candidato.",
    attempts
  });
}
