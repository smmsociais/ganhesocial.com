import pkg from "mongodb";
import { z } from "zod";

const { MongoClient, ObjectId } = pkg;
const MONGODB_URI = process.env.MONGODB_URI;
const API_URL = "https://ganhesocial.com/api";

// Cache para conexões (recomendado em serverless como Vercel)
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;

  const client = await MongoClient.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const db = client.db("ganhesocial");
  cachedClient = client;
  cachedDb = db;
  return db;
}

// Schema de validação para ações pendentes
const ActionSchema = z.object({
  _id: z.any(),
  nome_usuario: z.string().min(3),
  token: z.string().min(10),
  user: z.any(),
  id_pedido: z.string().min(3),
  url_dir: z.string().url(),
  tipo_acao: z.string(),
  quantidade_pontos: z.number(),
  id_conta: z.string().min(3)
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido. Use GET." });
  }

  try {
    console.log("▶ verificar-acoes chamado em", new Date().toISOString());

    const db = await connectToDatabase();
    const colecao = db.collection("actionhistories");
    console.log("Buscando ações pendentes em 'actionhistories'...");
    
    const acoes = await colecao.find({ acao_validada: null })
      .sort({ data: 1 })
      .limit(10)
      .toArray();

    console.log(`✅ Encontradas ${acoes.length} ações pendentes.`);
    if (acoes.length === 0) {
      console.log("🚫 Nenhuma ação pendente encontrada.");
      return res.status(200).json({ status: "ok", processadas: 0 });
    }

    let processadas = 0;
    for (const acao of acoes) {
      console.log("\n— Documento bruto:", JSON.stringify(acao));
      try {
        const valid = ActionSchema.parse(acao);
        console.log(`— Processando _id=${valid._id}, usuário='${valid.nome_usuario}', conta=${valid.id_conta}`);

        // 1) Busca info do usuário no TikTok
        const infoRes = await fetch(`${API_URL}/user-info?unique_id=${encodeURIComponent(valid.nome_usuario)}`);
        if (!infoRes.ok) throw new Error(`user-info retornou ${infoRes.status}`);
        const infoJson = await infoRes.json();
        const tiktokUserId = infoJson.data.user.id;
        console.log(`   • TikTok user ID: ${tiktokUserId}`);

        // 2) Busca lista de quem segue
        const followRes = await fetch(`${API_URL}/user-following?userId=${tiktokUserId}`);
        if (!followRes.ok) throw new Error(`user-following retornou ${followRes.status}`);
        const followJson = await followRes.json();
        console.log(`   • Recebeu ${followJson.data.followings.length} itens de seguindo`);

        // 3) Verifica se seguiu
        const seguiu = followJson.data.followings.some(f =>
          f.unique_id.replace(/^@/, "").toLowerCase() === valid.nome_usuario.toLowerCase()
        );
        console.log(`   • Resultado: ${seguiu ? "VALIDA" : "INVALIDA"}`);

        // 4) Atualiza documento
        await colecao.updateOne(
          { _id: new ObjectId(valid._id) },
          { $set: { acao_validada: seguiu, data_verificacao: new Date() } }
        );
        console.log(`   ✓ Ação ${valid._id} atualizada para acao_validada=${seguiu}`);
        processadas++;

      } catch (err) {
        console.error(`   ✗ Falha ao processar ação ${acao._id}:`, err.message || err);
      }
    }

    console.log(`✔ Fim do processamento: ${processadas} ações processadas.`);
    return res.status(200).json({ status: "ok", processadas });

  } catch (error) {
    console.error("✗ Erro geral em verificar-acoes:", error);
    return res.status(500).json({ error: "Erro interno", details: error.message });
  }
}
