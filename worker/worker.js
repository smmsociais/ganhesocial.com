// worker.js
import pkg from "mongodb";
import { z } from "zod";
import axios from "axios";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { DailyEarning } from "./schema.js"; // mantenha seu schema mongoose
import connectDB from "./db.js"; // sua função que faz mongoose.connect ou adpte

const { MongoClient, ObjectId } = pkg;
const MONGODB_URI = process.env.MONGODB_URI;
const API_URL = process.env.GANHESOCIAL_API_URL || "https://ganhesocial.com/api";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "15_000", 10); // 15s
const MAX_BATCH = parseInt(process.env.MAX_BATCH || "200", 10);

if (!MONGODB_URI) {
  console.error("✗ MONGODB_URI não definido. Abortando.");
  process.exit(1);
}

let cachedClient = null;
let cachedDb = null;
async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  cachedClient = client;
  cachedDb = client.db();
  return cachedDb;
}

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
  token: z.string().min(1),
});

async function processBatch() {
  try {
    const db = await connectToDatabase();
    await connectDB(); // garante Mongoose conectado para DailyEarning (se usar)
    const colecao = db.collection("actionhistories");
    const usuarios = db.collection("users");

    // pega até MAX_BATCH ações pendentes
    const acoes = await colecao.find({ acao_validada: "pendente", tipo: "seguir" })
      .sort({ data: 1 })
      .limit(MAX_BATCH)
      .toArray();

    if (!acoes || acoes.length === 0) {
      console.log("— Nenhuma ação pendente no momento.");
      return;
    }

    console.log(`📦 Encontradas ${acoes.length} ações pendentes — tentando processar.`);

    for (const acao of acoes) {
      // lock atômico: tenta marcar processing=true somente se ainda não estiver em processamento
      const lock = await colecao.findOneAndUpdate(
        { _id: new ObjectId(acao._id), processing: { $ne: true } },
        { $set: { processing: true, processingAt: new Date() } },
        { returnDocument: "after" }
      );

      if (!lock.value) {
        console.log(`— Pulando ${acao._id} (já em processamento por outra instância).`);
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
            timeout: 20_000
          });

          const followings = followingRes.data?.data?.followings || [];
          const match = valid.url_dir.toLowerCase().match(/@([\w_.]+)/);
          const targetUsername = match ? match[1] : valid.url_dir.replace(/^@/, "").toLowerCase();

          accountFound = followings.some(f => String(f.unique_id || "").toLowerCase() === targetUsername);
        } catch (e) {
          console.error("   ✗ Falha em /user-following:", e.message || e);
          // desmarca processing para permitir reprocessamento posterior
          await colecao.updateOne({ _id: new ObjectId(valid._id) }, { $set: { processing: false } });
          continue;
        }

        // atualiza registro (valida/invalida)
        await colecao.updateOne(
          { _id: new ObjectId(valid._id) },
          { $set: { acao_validada: accountFound ? "valida" : "invalida", verificada_em: new Date(), processing: false } }
        );

        if (accountFound) {
          const valor = parseFloat(valid.valor_confirmacao);
          if (!isNaN(valor) && valor > 0) {
            await usuarios.updateOne({ _id: new ObjectId(valid.user) }, { $inc: { saldo: valor } });
            // Atualiza DailyEarning (mongoose schema)
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

            // Notifica smmsociais (se aplicável)
            if (valid.id_pedido && process.env.SMM_API_KEY) {
              try {
                await axios.post("https://smmsociais.com/api/incrementar-validadas",
                  { id_acao_smm: valid.id_pedido },
                  { headers: { Authorization: `Bearer ${process.env.SMM_API_KEY}` }, timeout: 10_000 }
                );
              } catch (err) {
                console.error("   ✗ Erro notificando smmsociais:", err.message || err.response?.data || err);
              }
            }

            console.log(`   ✓ Saldo incrementado para user ${valid.user} em R$${valor}`);
          } else {
            console.warn("   ⚠ valor_confirmacao inválido:", valid.valor_confirmacao);
          }
        } else {
          console.log(`   ✗ Ação ${valid._id} considerada inválida (não encontrou o follow).`);
        }
      } catch (err) {
        console.error("   ✗ Erro ao processar ação:", err);
        // tenta limpar processing para reprocessamento futuro
        await colecao.updateOne({ _id: new ObjectId(acao._id) }, { $set: { processing: false } });
      }
    }

  } catch (err) {
    console.error("✗ Erro geral no processBatch:", err);
  }
}

async function mainLoop() {
  console.log("▶ Worker iniciar — polling a cada", POLL_INTERVAL_MS, "ms");
  while (true) {
    try {
      await processBatch();
    } catch (err) {
      console.error("Erro inesperado no loop:", err);
    }
    // aguarda intervalo antes da próxima varredura
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// start
mainLoop().catch(err => {
  console.error("Erro fatal no worker:", err);
  process.exit(1);
});
