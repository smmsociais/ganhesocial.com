import pkg from "mongodb";
import { z } from "zod";

const { MongoClient, ObjectId } = pkg;
const MONGODB_URI = process.env.MONGODB_URI;
const API_URL = "https://ganhesocial.com/api";

// cache para serverless
let cachedClient = null;
let cachedDb = null;
async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  // usa o default DB da URI
  const db = client.db();
  cachedClient = client;
  cachedDb = db;
  return db;
}

// schema para validar mínimos campos
const ActionSchema = z.object({
  _id: z.any(),
  nome_usuario: z.string().min(1),
  id_conta: z.string().min(1),
  id_pedido: z.string().min(1),
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido. Use GET." });
  }

  try {
    console.log("▶ verificar-acoes chamado em", new Date().toISOString());

    const db = await connectToDatabase();
    console.log("✔ Conectado ao MongoDB");
    const colecao = db.collection("actionhistories");

    console.log("Buscando ações pendentes em 'actionhistories'…");
    const acoes = await colecao.find({ acao_validada: null })
      .sort({ data: 1 })
      .limit(10)
      .toArray();

    console.log(`✅ Encontradas ${acoes.length} ações pendentes.`);
    if (acoes.length === 0) {
      return res.status(200).json({ status: "ok", processadas: 0 });
    }

    let processadas = 0;
    for (const acao of acoes) {
      console.log("— Documento bruto:", acao);
      try {
        const valid = ActionSchema.parse(acao);
        console.log(`— Processando _id=${valid._id}, usuário='${valid.nome_usuario}'`);

        // ... as suas chamadas a `/user-info` e `/user-following`
        // e o updateOne abaixo:
        await colecao.updateOne(
          { _id: new ObjectId(valid._id) },
          { $set: { acao_validada: /* true/false */, data_verificacao: new Date() } }
        );
        processadas++;
        console.log(`   ✓ Ação ${valid._id} atualizada.`);
      } catch (err) {
        console.error(`   ✗ Falha ao processar ação ${acao._id}:`, err);
      }
    }

    console.log(`✔ Fim do processamento: ${processadas} ações processadas.`);
    return res.status(200).json({ status: "ok", processadas });

  } catch (error) {
    console.error("✗ Erro geral em verificar-acoes:", error);
    return res.status(500).json({ error: "Erro interno", details: error.message });
  }
}
