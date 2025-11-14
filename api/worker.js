// api/worker.js
import axios from "axios";
import { z } from "zod";
import pkg from "mongodb";
const { MongoClient, ObjectId } = pkg;

const MONGODB_URI = process.env.MONGODB_URI;
const API_URL = process.env.GANHESOCIAL_API_URL || "https://ganhesocial.com/api";
const MAX_BATCH = parseInt(process.env.MAX_BATCH || "30", 10); // mantenha baixo para evitar timeout
const FOLLOWING_TIMEOUT_MS = parseInt(process.env.FOLLOWING_TIMEOUT_MS || "4000", 10); // axios timeout curto

if (!MONGODB_URI) {
  console.error("✗ MONGODB_URI não definido.");
  // Não encerra (serverless) — apenas falha com 500 quando invocado.
}

let cachedClient = null;
let cachedDb = null;
async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  cachedClient = client;
  cachedDb = client.db();
  return cachedDb;
}

// tenta importar arquivos locais (opcional) — db/schema mongoose
let DailyEarning = null;
async function tryImportLocalFiles() {
  try {
    const modDb = await import("../worker/db.js").catch(() => null);
    if (modDb) {
      await (modDb.default ? modDb.default() : (modDb.connectDB ? modDb.connectDB() : Promise.resolve()));
      console.log("→ db.js importado (mongoose)"); 
    }
  } catch (e) {
    console.warn("→ não conseguiu importar db.js:", e.message);
  }

  try {
    const modSchema = await import("../worker/schema.js").catch(() => null);
    if (modSchema && modSchema.DailyEarning) {
      DailyEarning = modSchema.DailyEarning;
      console.log("→ schema.js importado (DailyEarning disponível)");
    }
  } catch (e) {
    console.warn("→ não conseguiu importar schema.js:", e.message);
  }
}

// Validação
const ActionSchema = z.object({
  _id: z.any(),
  user: z.any(),
  nome_usuario: z.string().min(1),
  id_pedido: z.string().min(1).optional(),
  id_conta: z.string().min(1),
  url_dir: z.string().min(1),
  quantidade_pontos: z.number().optional(),
  valor_confirmacao: z.union([z.string(), z.number()]).optional(),
  tipo_acao: z.string().min(1),
  token: z.string().min(1)
});

async function processBatch() {
  const db = await connectToDatabase();
  const colecao = db.collection("actionhistories");
  const usuarios = db.collection("users");

  const acoes = await colecao.find({ acao_validada: "pendente", tipo: "seguir" })
    .sort({ data: 1 })
    .limit(MAX_BATCH)
    .toArray();

  if (!acoes || acoes.length === 0) {
    return { processed: 0, validated: 0, invalidated: 0, skipped: 0 };
  }

  let processed = 0, validated = 0, invalidated = 0, skipped = 0;

  for (const acao of acoes) {
    // lock atômico
    const lock = await colecao.findOneAndUpdate(
      { _id: new ObjectId(acao._id), processing: { $ne: true } },
      { $set: { processing: true, processingAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!lock.value) {
      skipped++;
      continue;
    }

    try {
      const valid = ActionSchema.parse(acao);
      processed++;

      // verifica se segue
      let accountFound = false;
      try {
        const idConta = String(valid.id_conta).trim();
        const followingRes = await axios.get(`${API_URL}/user-following?userId=${encodeURIComponent(idConta)}`, {
          headers: { Authorization: `Bearer ${valid.token}` },
          timeout: FOLLOWING_TIMEOUT_MS
        });

        const followings = followingRes.data?.data?.followings || [];
        const match = valid.url_dir.toLowerCase().match(/@([\w_.]+)/);
        const targetUsername = match ? match[1] : valid.url_dir.replace(/^@/, "").toLowerCase();

        accountFound = followings.some(f => String(f.unique_id || "").toLowerCase() === targetUsername);
      } catch (err) {
        // API externa falhou — desbloqueia para reprocessar posteriormente
        await colecao.updateOne({ _id: new ObjectId(valid._id) }, { $set: { processing: false } });
        skipped++;
        continue;
      }

      await colecao.updateOne(
        { _id: new ObjectId(valid._id) },
        { $set: { acao_validada: accountFound ? "valida" : "invalida", verificada_em: new Date(), processing: false } }
      );

      if (accountFound) {
        validated++;
        const valor = parseFloat(valid.valor_confirmacao);
        if (!isNaN(valor) && valor > 0) {
          await usuarios.updateOne({ _id: new ObjectId(valid.user) }, { $inc: { saldo: valor } });

          // atualiza DailyEarning (mongoose) se disponível
          if (DailyEarning) {
            try {
              const agora = new Date();
              const brasilAgora = new Date(agora.getTime() + (-3) * 3600 * 1000);
              const brasilMidnightTomorrow = new Date(Date.UTC(
                brasilAgora.getUTCFullYear(),
                brasilAgora.getUTCMonth(),
                brasilAgora.getUTCDate() + 1,
                3, 0, 0, 0
              ));
              await DailyEarning.updateOne(
                { userId: new ObjectId(valid.user), expiresAt: brasilMidnightTomorrow },
                { $inc: { valor }, $setOnInsert: { expiresAt: brasilMidnightTomorrow } },
                { upsert: true }
              );
            } catch (err) {
              console.warn("Erro atualizando DailyEarning:", err.message || err);
            }
          }

          // Notifica smmsociais se necessário
          if (valid.id_pedido && process.env.SMM_API_KEY) {
            try {
              await axios.post("https://smmsociais.com/api/incrementar-validadas",
                { id_acao_smm: valid.id_pedido },
                { headers: { Authorization: `Bearer ${process.env.SMM_API_KEY}` }, timeout: 3000 }
              );
            } catch (err) {
              console.warn("Erro notificando smmsociais:", err.message || err.response?.data || err);
            }
          }
        }
      } else {
        invalidated++;
      }

    } catch (err) {
      console.error("Erro processando ação:", err);
      await colecao.updateOne({ _id: new ObjectId(acao._id) }, { $set: { processing: false } });
      skipped++;
    }
  }

  return { processed, validated, invalidated, skipped };
}

// handler (Vercel Cron usa GET)
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET" });
    return;
  }

  try {
    await tryImportLocalFiles();
    const stats = await processBatch();
    res.status(200).json({ ok: true, stats, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("worker error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
