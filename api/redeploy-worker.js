import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Use GET" });
  }

  const { RENDER_SERVICE_ID, RENDER_API_KEY } = process.env;

  if (!RENDER_SERVICE_ID || !RENDER_API_KEY) {
    return res.status(500).json({ error: "Variáveis de ambiente ausentes." });
  }

  try {
    const response = await axios.post(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys`,
      {}, // corpo vazio (requerido pela API do Render)
      {
        headers: {
          Authorization: `Bearer ${RENDER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.status(200).json({
      ok: true,
      message: "Deploy acionado com sucesso!",
      data: response.data
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
}
