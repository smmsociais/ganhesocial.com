import pkg from "mongodb";
import { z } from "zod";
import axios from "axios";

const { MongoClient, ObjectId } = pkg;
const MONGODB_URI = process.env.MONGODB_URI;
const API_URL = "https://ganhesocial.com/api";

let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  const db = client.db();
  cachedClient = client;
  cachedDb = db;
  return db;
}

const ActionSchema = z.object({
  _id: z.any(),
  nome_usuario: z.string().min(1),
  id_pedido: z.string().min(1),
  id_conta: z.string().min(1),
  url_dir: z.string().min(1),
  quantidade_pontos: z.number(),
  valor_confirmacao: z.union([z.string(), z.number()]),
  tipo_acao: z.string().min(1),
  user_id: z.string().optional(),
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido. Use GET." });
  }

  try {
    console.log("▶ verificar-acoes chamado em", new Date().toISOString());

    const db = await connectToDatabase();
    const colecao = db.collection("actionhistories");
    const usuarios = db.collection("usuarios");

    const acoes = await colecao.find({ acao_validada: null })
      .sort({ data: 1 })
      .limit(10)
      .toArray();

    console.log(`📦 Encontradas ${acoes.length} ações pendentes.`);
    if (acoes.length === 0) {
      return res.status(200).json({ status: "ok", processadas: 0 });
    }

    let processadas = 0;

    for (const acao of acoes) {
      console.log("— Documento bruto:", acao);
      try {
        const valid = ActionSchema.parse(acao);
        console.log(`— Processando _id=${valid._id}, usuário='${valid.nome_usuario}'`);

        // 1. Obtemos o ID do usuário no TikTok
        let tiktokUserId;
        try {
          const userInfoRes = await axios.get(`${API_URL}/user-info?unique_id=${valid.nome_usuario.replace(/^@/, '')}`);
          const userInfo = userInfoRes.data;

          if (!userInfo || userInfo.code !== 0 || !userInfo.data?.user?.id) {
            throw new Error("TikTok user info inválido");
          }
          tiktokUserId = userInfo.data.user.id;
        } catch (e) {
          console.error("   ✗ Falha em /user-info:", e.message);
          continue;
        }

        // 2. Verificamos se ele está seguindo o perfil-alvo
        let accountFound = false;
        try {
          const followingRes = await axios.get(`${API_URL}/user-following?userId=${tiktokUserId}`);
          const followingData = followingRes.data;

          if (followingData.code === 0 && followingData.data?.followings?.length > 0) {
            const followings = followingData.data.followings;

            // Extrai o @username do campo url_dir (link ou @nome)
            let targetUsername = valid.url_dir.toLowerCase();
            const match = targetUsername.match(/@([a-zA-Z0-9_.]+)/);
            targetUsername = match ? match[1] : targetUsername.replace(/^@/, '');

            accountFound = followings.some(f => {
              const followingUsername = f.unique_id?.toLowerCase();
              return followingUsername === targetUsername;
            });
          }
        } catch (e) {
          console.error("   ✗ Falha em /user-following:", e.message);
          continue;
        }

        const resultadoVerificacao = accountFound;
        const updateFields = {
          acao_validada: resultadoVerificacao,
          verificada_em: new Date()
        };

        await colecao.updateOne(
          { _id: new ObjectId(valid._id) },
          { $set: updateFields }
        );

if (resultadoVerificacao && valid.user_id) {
  let valor = parseFloat(valid.valor_confirmacao);
  if (!isNaN(valor) && valor > 0) {
    await usuarios.updateOne(
      { _id: new ObjectId(valid.user_id) },
      { $inc: { saldo: valor } }
    );
  } else {
    console.warn(`   ⚠ valor_confirmacao inválido para ação ${valid._id}:`, valid.valor_confirmacao);
  }
}
        console.log(`   ✓ Ação ${valid._id} atualizada: acao_validada=${resultadoVerificacao}`);
        processadas++;

      } catch (err) {
        console.error(`   ✗ Erro ao processar ação ${acao._id}:`, err.message);
      }
    }

    console.log(`✔ Fim do processamento: ${processadas} ações processadas.`);
    return res.status(200).json({ status: "ok", processadas });

  } catch (error) {
    console.error("✗ Erro geral em verificar-acoes:", error);
    return res.status(500).json({ error: "Erro interno", details: error.message });
  }
}
