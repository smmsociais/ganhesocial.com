// index.js
import express from "express";
import axios from "axios";
import { z } from "zod";
import pkg from "mongodb";
import mongoose from "mongoose";

const { MongoClient, ObjectId } = pkg;

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const API_URL = process.env.GANHESOCIAL_API_URL || "https://ganhesocial.com/api";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "15000", 10); // 15s default
const MAX_BATCH = parseInt(process.env.MAX_BATCH || "200", 10);

if (!MONGODB_URI) {
  console.error("✗ MONGODB_URI não definido. Defina nas env vars e tente novamente.");
  process.exit(1);
}

/**
 * OPTIONAL: se você já tem connectDB (mongoose) e schema DailyEarning no repo,
 * vamos tentar importá-los dinamicamente. Se não existirem, prosseguimos sem.
 */
let DailyEarning = null;
async function tryImportLocalFiles() {
  try {
    console.log("→ tryImportLocalFiles: tentando importar ./db.js");
    const modDb = await import("./db.js");
    console.log("→ db.js import OK", !!modDb);
    await (modDb.default ? modDb.default() : (modDb.connectDB ? modDb.connectDB() : Promise.resolve()));
    console.log("→ mongoose conectado (tentativa)");
  } catch (e) {
    console.error("! tryImportLocalFiles: erro import ./db.js:", e.message);
  }

  try {
    console.log("→ tryImportLocalFiles: tentando importar ./schema.js");
    const modSchema = await import("./schema.js");
    DailyEarning = modSchema.DailyEarning;
    console.log("→ schema import OK, DailyEarning definido?", !!DailyEarning);
  } catch (e) {
    console.error("! tryImportLocalFiles: erro import ./schema.js:", e.message);
  }
}
// Conexão Mongo (driver nativo) com cache
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

// Schema de validação da ação (adapte se necessário)
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
    console.log("— Nenhuma ação pendente.");
    return;
  }

  console.log(`📦 ${acoes.length} ações pendentes (tentando processar).`);

  for (const acao of acoes) {
    // lock atômico
    const lock = await colecao.findOneAndUpdate(
      { _id: new ObjectId(acao._id), processing: { $ne: true } },
      { $set: { processing: true, processingAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!lock.value) {
      console.log(`— Pulando ${acao._id} (já em processamento).`);
      continue;
    }

    try {
      const valid = ActionSchema.parse(acao);
      console.log(`— Processando _id=${valid._id} user=${valid.user}`);

      let accountFound = false;
      try {
        const idConta = String(valid.id_conta).trim();
        const followingRes = await axios.get(`${API_URL}/user-following?userId=${encodeURIComponent(idConta)}`, {
          headers: { Authorization: `Bearer ${valid.token}` },
          timeout: 20000
        });

        const followings = followingRes.data?.data?.followings || [];
        const match = valid.url_dir.toLowerCase().match(/@([\w_.]+)/);
        const targetUsername = match ? match[1] : valid.url_dir.replace(/^@/, "").toLowerCase();

        accountFound = followings.some(f => String(f.unique_id || "").toLowerCase() === targetUsername);
      } catch (err) {
        console.error("   ✗ Erro na chamada /user-following:", err.message || err);
        // desmarca processing para reprocessamento futuro
        await colecao.updateOne({ _id: new ObjectId(valid._id) }, { $set: { processing: false } });
        continue;
      }

      await colecao.updateOne(
        { _id: new ObjectId(valid._id) },
        { $set: { acao_validada: accountFound ? "valida" : "invalida", verificada_em: new Date(), processing: false } }
      );

      if (accountFound) {
        const valor = parseFloat(valid.valor_confirmacao);
        if (!isNaN(valor) && valor > 0) {
          await usuarios.updateOne({ _id: new ObjectId(valid.user) }, { $inc: { saldo: valor } });

          // se tiver DailyEarning (mongoose) disponível, atualiza
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
              console.error("   ⚠ Erro ao atualizar DailyEarning:", err.message || err);
            }
          }

          // notifica smmsociais se aplicável
          if (valid.id_pedido && process.env.SMM_API_KEY) {
            try {
              await axios.post("https://smmsociais.com/api/incrementar-validadas",
                { id_acao_smm: valid.id_pedido },
                { headers: { Authorization: `Bearer ${process.env.SMM_API_KEY}` }, timeout: 10000 }
              );
            } catch (err) {
              console.error("   ✗ Erro notificando smmsociais:", err.message || err.response?.data || err);
            }
          }

          console.log(`   ✓ Incrementado saldo user ${valid.user} R$${valor}`);
        } else {
          console.warn("   ⚠ valor_confirmacao inválido:", valid.valor_confirmacao);
        }
      } else {
        console.log(`   ✗ Ação ${valid._id} inválida (não encontrou follow).`);
      }
    } catch (err) {
      console.error("   ✗ Erro ao processar ação:", err);
      await colecao.updateOne({ _id: new ObjectId(acao._id) }, { $set: { processing: false } });
    }
  }
}

// loop principal
async function mainLoop() {
  console.log("▶ Worker iniciado — iniciando polling.");
  await tryImportLocalFiles(); // tenta importar connectDB/schema se presentes
  while (true) {
    try {
      await processBatch();
    } catch (err) {
      console.error("✗ Erro no processBatch:", err);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/* ----- Express server mínimo para manter processo vivo no Render ----- */
const app = express();

app.get("/", (req, res) => res.send("Worker GanheSocial ativo 🚀"));

app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`🌍 HTTP server rodando na porta ${PORT}`);
  // inicia loop após servidor subir
  mainLoop().catch(err => {
    console.error("Erro fatal no worker:", err);
    process.exit(1);
  });
});
