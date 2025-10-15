import axios from "axios";
import querystring from "querystring";

const RAPID_HOST = "cybrix-bytedance1.p.rapidapi.com";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido" });

  const { unique_id } = req.query;
  if (!unique_id) return res.status(400).json({ error: "unique_id obrigatório" });

  const key = process.env.RAPIDAPI_KEY || process.env.rapidapi_key;
  if (!key) return res.status(500).json({ error: "RAPIDAPI_KEY não configurada" });

  const attempts = [];

  // helpers
  const doReq = async (method, url, opts = {}) => {
    try {
      const r = await axios.request({ method, url, ...opts, timeout: 10000 });
      return { ok: true, status: r.status, data: r.data, attempt: { method, url, opts } };
    } catch (e) {
      return {
        ok: false,
        status: e.response?.status,
        data: e.response?.data || e.message,
        attempt: { method, url, opts }
      };
    }
  };

  const base = `https://${RAPID_HOST}`;
  const paths = ["/scraping/user/info", "/scraping/user", "/user/info", "/user"];

  // 1) try GET with original path and params
  attempts.push(await doReq("get", base + paths[0], {
    headers: { "x-rapidapi-key": key, "x-rapidapi-host": RAPID_HOST },
    params: { username: unique_id }
  }));

  // 2) try POST JSON
  attempts.push(await doReq("post", base + paths[0], {
    headers: { "x-rapidapi-key": key, "x-rapidapi-host": RAPID_HOST, "Content-Type": "application/json" },
    data: { username: unique_id }
  }));

  // 3) try form-urlencoded
  attempts.push(await doReq("post", base + paths[0], {
    headers: { "x-rapidapi-key": key, "x-rapidapi-host": RAPID_HOST, "Content-Type": "application/x-www-form-urlencoded" },
    data: querystring.stringify({ username: unique_id })
  }));

  // 4) try text/plain
  attempts.push(await doReq("post", base + paths[0], {
    headers: { "x-rapidapi-key": key, "x-rapidapi-host": RAPID_HOST, "Content-Type": "text/plain" },
    data: unique_id
  }));

  // 5) try alternative paths (GET)
  for (const p of paths.slice(1)) {
    attempts.push(await doReq("get", base + p, {
      headers: { "x-rapidapi-key": key, "x-rapidapi-host": RAPID_HOST },
      params: { username: unique_id }
    }));
  }

  // return attempts so you can inspect each response
  return res.status(200).json({ attempts });
}
