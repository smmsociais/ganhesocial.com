import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  const { unique_id } = req.query;
  if (!unique_id) {
    return res.status(400).json({ error: "Parâmetro 'unique_id' é obrigatório." });
  }

  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || process.env.rapidapi_key;
  if (!RAPIDAPI_KEY) {
    console.error("RAPIDAPI_KEY não definido no ambiente.");
    return res.status(500).json({ error: "Chave de API não configurada no servidor (RAPIDAPI_KEY)." });
  }

  const baseUrl = "https://cybrix-bytedance1.p.rapidapi.com";
  // mantenha apenas o caminho base aqui — o provider pode ter paths diferentes
  const path = "/scraping/user/info"; // original — vamos tentar GET e, se 404, um POST fallback

  const headers = {
    "x-rapidapi-key": RAPIDAPI_KEY,
    "x-rapidapi-host": "cybrix-bytedance1.p.rapidapi.com",
    "Content-Type": "application/json",
    Accept: "application/json"
  };

  try {
    // 1) Tentar GET corretamente com params (sem body)
    const url = `${baseUrl}${path}`;
    const getResp = await axios.get(url, {
      headers,
      params: { username: unique_id },
      timeout: 10000
    });

    if (!getResp.data || Object.keys(getResp.data).length === 0) {
      return res.status(404).json({ error: "Nenhuma informação encontrada para esse usuário." });
    }

    return res.status(200).json(getResp.data);
  } catch (err) {
    // Se a resposta veio do provedor — inspecione o status
    if (err.response) {
      const pStatus = err.response.status;
      const pData = err.response.data;

      console.error("Resposta da API terceirizada:", { status: pStatus, data: pData });

      // Se for 404 do provedor indicando "Endpoint ... does not exist", TENTAR fallback com POST
      const providerMsg = typeof pData === "object" ? JSON.stringify(pData) : String(pData);

      if (pStatus === 404) {
        // tentativa de POST (algumas APIs esperam body JSON)
        try {
          const postUrl = `${baseUrl}${path}`;
          const postResp = await axios.post(
            postUrl,
            { username: unique_id },
            { headers, timeout: 10000 }
          );

          if (!postResp.data || Object.keys(postResp.data).length === 0) {
            return res.status(404).json({ error: "Nenhuma informação encontrada para esse usuário (POST fallback)." });
          }

          return res.status(200).json(postResp.data);
        } catch (err2) {
          if (err2.response) {
            console.error("Fallback POST também falhou:", { status: err2.response.status, data: err2.response.data });
            return res.status(502).json({
              error: "Erro da API externa (fallback POST).",
              provider_status: err2.response.status,
              provider_data: err2.response.data
            });
          }
          console.error("Erro de rede no fallback POST:", err2.message);
          return res.status(500).json({ error: "Erro no fallback POST ao buscar dados do TikTok.", details: err2.message });
        }
      }

      // para outros códigos (401, 403, 400, etc.) devolve mensagem do provedor para debug
      return res.status(502).json({
        error: "Erro da API externa ao buscar dados do TikTok.",
        provider_status: pStatus,
        provider_data: pData
      });
    }

    // erro de rede / timeout / etc
    console.error("Erro de rede/timeout ao consultar API externa:", err.message);
    return res.status(500).json({ error: "Erro ao buscar dados do TikTok.", details: err.message });
  }
}
