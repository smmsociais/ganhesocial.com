import pkg from "mongodb";
import { z } from "zod";
import axios from "axios";
import jwt from "jsonwebtoken";
import { DailyEarning } from "./schema.js";

const { MongoClient, ObjectId } = pkg;

const MONGODB_URI = process.env.MONGODB_URI;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const BASE_URL = process.env.BASE_URL;
const SMM_API_KEY = process.env.SMM_API_KEY;

const API_URL = "https://tiktok-api23.p.rapidapi.com/api/user/liked-posts";

let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  cachedDb = client.db();
  return cachedDb;
}

const ActionSchema = z.object({
  _id: z.any(),
  user: z.any(),
  url_dir: z.string().min(1),
  nome_usuario: z.string().min(1),
  valor_confirmacao: z.union([z.string(), z.number()]),
  quantidade_pontos: z.number(),
  tipo_acao: z.literal("curtir"),
  token: z.string(),
  id_pedido: z.string().optional().nullable(),
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido. Use GET." });
  }

  const vercelJwt = req.headers["x-vercel-oidc-token"];
  if (!vercelJwt) {
    return res.status(403).json({ error: "Token de autorização ausente" });
  }

  try {
    const decoded = jwt.decode(vercelJwt);
    if (!decoded || decoded.aud !== "https://vercel.com/ganhesocialcom" || decoded.iss !== "https://oidc.vercel.com/ganhesocialcom") {
      throw new Error("Token inválido");
    }

    const db = await connectToDatabase();
    const colecao = db.collection("actionhistories");
    const usuarios = db.collection("users");

    const acoes = await colecao.find({ acao_validada: null, tipo_acao: "curtir" }).limit(100).toArray();
    if (acoes.length === 0) {
      return res.status(200).json({ status: "ok", processadas: 0 });
    }

    let processadas = 0;

    for (const acao of acoes) {
      try {
        const valid = ActionSchema.parse(acao);

        const match = valid.url_dir.match(/video\/(\d+)/);
        if (!match) continue;
        const videoId = match[1];

        // Buscar secUid do TikTok via API interna
        const infoRes = await axios.get(`${BASE_URL}/api/user-info?unique_id=${valid.nome_usuario}`);
        const secUid = infoRes.data?.data?.user?.secUid;

        if (!secUid) {
          console.warn(`secUid não encontrado para nome_usuario: ${valid.nome_usuario}`);
          continue;
        }

        // Buscar vídeos curtidos
        const likedRes = await axios.get(API_URL, {
          params: { secUid, count: "30", cursor: "0" },
          headers: {
            "x-rapidapi-key": RAPIDAPI_KEY,
            "x-rapidapi-host": "tiktok-api23.p.rapidapi.com",
          },
        });

        const likedVideos = likedRes.data?.itemList || [];
        const liked = likedVideos.some(v => v.id === videoId || v.video_id === videoId);

        await colecao.updateOne(
          { _id: new ObjectId(valid._id) },
          { $set: { acao_validada: liked, verificada_em: new Date() } }
        );

        if (liked) {
          const valor = parseFloat(valid.valor_confirmacao);
          if (!isNaN(valor) && valor > 0) {
            await usuarios.updateOne(
              { _id: new ObjectId(valid.user) },
              { $inc: { saldo: valor } }
            );

            const agora = new Date();
            const brasilMidnight = new Date(Date.UTC(
              agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 1, 3, 0, 0
            ));

            await DailyEarning.create({
              userId: new ObjectId(valid.user),
              valor,
              data: new Date(),
              expiresAt: brasilMidnight,
            });
          }

          // Notificar smmsociais.com se houver id_pedido
          if (valid.id_pedido) {
            try {
              await axios.post(
                "https://smmsociais.com/api/incrementar-validadas",
                { id_acao_smm: valid.id_pedido },
                {
                  headers: { Authorization: `Bearer ${SMM_API_KEY}` }
                }
              );
            } catch (err) {
              console.error("Erro ao notificar smmsociais.com:", err.response?.data || err.message);
            }
          }
        }

        processadas++;
      } catch (err) {
        console.error("Erro ao processar ação:", err.message || err);
      }
    }

    return res.status(200).json({ status: "ok", processadas });

  } catch (err) {
    console.error("Erro geral:", err.message || err);
    return res.status(500).json({ error: "Erro interno", details: err.message });
  }
}
