import pkg from "mongodb";
import { z } from "zod";
import axios from "axios";

export default async function handler(req, res) {
  // Verificação do token
  const authHeader = req.headers.authorization;
  const SECRET = process.env.VERIFICAR_ACOES_SECRET;

  if (authHeader !== `Bearer ${SECRET}`) {
    return res.status(403).json({ error: "Não autorizado" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido. Use GET." });
  }

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

// Schema mínimo para validar ação
const ActionSchema = z.object({
  _id: z.any(),
  user: z.any(),                // pega o ObjectId do campo `user`
  nome_usuario: z.string().min(1),
  id_pedido: z.string().min(1),
  id_conta: z.string().min(1),
  url_dir: z.string().min(1),
  quantidade_pontos: z.number(),
  valor_confirmacao: z.union([z.string(), z.number()]),
  tipo_acao: z.string().min(1),
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido. Use GET." });
  }

  try {
    console.log("▶ verificar-acoes chamado em", new Date().toISOString());

    const db = await connectToDatabase();
    const colecao = db.collection("actionhistories");
    const usuarios = db.collection("users");       // ajuste para a coleção correta

    const acoes = await colecao.find({ acao_validada: null })
      .sort({ data: 1 })
      .limit(120)
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

// ...dentro do for, ao invés de usar unique_id ou id_conta:
let accountFound = false;
try {
  // idConta é o string(valid.id_conta)
  const idConta = String(valid.id_conta).trim();
  if (!/^\d+$/.test(idConta)) {
    throw new Error(`id_conta inválido: ${idConta}`);
  }

  // CHAMADA CORRETA à sua rota de user-following
  const followingRes = await axios.get(
    `${API_URL}/user-following?userId=${idConta}`,
    {
      headers: {
        // usa o token que você salvou junto com a action no banco
        Authorization: `Bearer ${valid.token}`
      }
    }
  );

  const followingData = followingRes.data;
  if (followingData.code === 0 && Array.isArray(followingData.data?.followings)) {
    const followings = followingData.data.followings;
    // extrai o username alvo da URL (ex: /@foo → foo)
    let targetUsername = valid.url_dir.toLowerCase();
    const match = targetUsername.match(/@([\w_.]+)/);
    targetUsername = match ? match[1] : targetUsername.replace(/^@/, '');

    accountFound = followings.some(f =>
      f.unique_id?.toLowerCase() === targetUsername
    );
  }
} catch (e) {
  console.error("   ✗ Falha em /user-following:", e.message);
  continue;
}

        // 2. Atualiza acao_validada
        await colecao.updateOne(
          { _id: new ObjectId(valid._id) },
          { $set: { acao_validada: accountFound, verificada_em: new Date() } }
        );

        // 3. Se validada, soma ao saldo do usuário
        if (accountFound) {
          const valor = parseFloat(valid.valor_confirmacao);
          if (!isNaN(valor) && valor > 0) {
            await usuarios.updateOne(
              { _id: new ObjectId(valid.user) },
              { $inc: { saldo: valor } }
            );
            console.log(`   ✓ Saldo do usuário ${valid.user} incrementado em ${valor}`);
          } else {
            console.warn(
              `   ⚠ valor_confirmacao inválido para ação ${valid._id}:`,
              valid.valor_confirmacao
            );
          }
        }

        console.log(`   ✓ Ação ${valid._id} atualizada: acao_validada=${accountFound}`);
        processadas++;

      } catch (err) {
        console.error(`   ✗ Erro ao processar ação ${acao._id}:`, err);
      }
    }

    console.log(`✔ Fim do processamento: ${processadas} ações processadas.`);
    return res.status(200).json({ status: "ok", processadas });

  } catch (error) {
    console.error("✗ Erro geral em verificar-acoes:", error);
    return res.status(500).json({ error: "Erro interno", details: error.message });
  }
}
