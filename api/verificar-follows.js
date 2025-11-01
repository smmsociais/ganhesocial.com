// api/verificar-follows.js
import pkg from "mongodb";
import { z } from "zod";
import axios from "axios";
import jwt from "jsonwebtoken";
import { DailyEarning } from "./schema.js";
import connectDB from "./db.js";

const { MongoClient, ObjectId } = pkg;
const MONGODB_URI = process.env.MONGODB_URI;
const API_URL = "https://ganhesocial.com/api";

let cachedClient = null;
let cachedDb = null;

/**
 * Conecta/retorna { client, db } para permitir transações quando possível.
 */
async function connectToDatabase() {
  if (cachedDb && cachedClient) return { client: cachedClient, db: cachedDb };
  const client = await MongoClient.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  cachedClient = client;
  cachedDb = client.db();
  return { client, db: cachedDb };
}

const ActionSchema = z.object({
  _id: z.any(),
  user: z.any(),
  nome_usuario: z.string().min(1),
  id_pedido: z.string().min(1),
  id_conta: z.string().min(1),
  url_dir: z.string().min(1),
  quantidade_pontos: z.number().optional(),
  valor_confirmacao: z.union([z.string(), z.number()]),
  tipo_acao: z.string().min(1),
  token: z.string().min(1),
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido. Use GET." });
  }

  const vercelJwt = req.headers["x-vercel-oidc-token"];
  if (!vercelJwt) {
    return res.status(403).json({ error: "Authorization token missing" });
  }

  try {
    const decoded = jwt.decode(vercelJwt);
    const expectedAud = "https://vercel.com/ganhesocialcom";
    const expectedIss = "https://oidc.vercel.com/ganhesocialcom";

    if (!decoded || decoded.aud !== expectedAud || decoded.iss !== expectedIss) {
      throw new Error("Invalid token");
    }

    // job id para rastreamento (não requer lib externa)
    const JOB_ID = process.env.JOB_ID || `job-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    console.log("▶ verificar-follows chamado em", new Date().toISOString(), "JOB_ID=", JOB_ID);

    // Conexões
    const { client, db } = await connectToDatabase();
    await connectDB(); // mantém sua conexão Mongoose para DailyEarning
    const colecao = db.collection("actionhistories");
    const usuarios = db.collection("users");

    // Parâmetros
    const MAX_CLAIMS = 3;
    const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos, ajustável

    // Claim/lock atômico até MAX_CLAIMS itens
    const claimed = [];
    for (let i = 0; i < MAX_CLAIMS; i++) {
      const staleThreshold = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
      const claim = await colecao.findOneAndUpdate(
        {
          $or: [
            { acao_validada: "pendente" },
            {
              acao_validada: "em_processo",
              processingAt: { $lt: staleThreshold } // re-claim tasks stuck por muito tempo
            }
          ]
        },
        {
          $set: {
            acao_validada: "em_processo",
            processingBy: JOB_ID,
            processingAt: new Date()
          }
        },
        { returnDocument: "after" }
      );

      if (!claim.value) break;
      claimed.push(claim.value);
    }

    console.log(`🔒 Job ${JOB_ID} reivindicou ${claimed.length} ações.`);

    if (claimed.length === 0) {
      return res.status(200).json({ status: "ok", processadas: 0 });
    }

    let processadas = 0;

    for (const acaoDoc of claimed) {
      try {
        const valid = ActionSchema.parse(acaoDoc);
        console.log(`— Processando _id=${valid._id}, usuário='${valid.nome_usuario}' (processingBy=${valid.processingBy || JOB_ID})`);

        // ---- Verifica follow via sua rota /user-following ----
        let accountFound = false;
        try {
          const idConta = String(valid.id_conta).trim();
          if (!idConta) throw new Error(`id_conta inválido: ${idConta}`);

          const followingRes = await axios.get(`${API_URL}/user-following?userId=${encodeURIComponent(idConta)}`, {
            headers: { Authorization: `Bearer ${valid.token}` },
            timeout: 15000
          });

          const followings = followingRes.data?.data?.followings || [];

          const match = valid.url_dir.toLowerCase().match(/@([\w_.]+)/);
          const targetUsername = match ? match[1] : valid.url_dir.replace(/^@/, "").toLowerCase();

          accountFound = followings.some(f => f.unique_id && f.unique_id.toLowerCase() === targetUsername);
        } catch (e) {
          console.error("   ✗ Falha em /user-following:", e.message || e);
          // marcar como não verificada? vamos setar verificada_em e manter 'em_processo' para retry futuros
          await colecao.updateOne(
            { _id: valid._id, processingBy: JOB_ID },
            { $set: { lastCheckError: String(e.message || e), processingAt: new Date() } }
          );
          continue; // passa para próxima ação reivindicada
        }

        // ---- Se não encontrado: marca como inválida e finalize ----
        if (!accountFound) {
          await colecao.updateOne(
            { _id: valid._id },
            { $set: { acao_validada: "invalida", verificada_em: new Date(), processingBy: null, processingAt: null } }
          );
          console.log(`   ✗ Ação ${valid._id} marcada como invalida.`);
          processadas++;
          continue;
        }

        // ---- Se encontrado: precisamos incrementar saldo de forma segura ----
        const valor = parseFloat(valid.valor_confirmacao);
        if (isNaN(valor) || valor <= 0) {
          console.warn(`   ⚠ valor_confirmacao inválido para ação ${valid._id}:`, valid.valor_confirmacao);
          // marca verificada para não ficar pendente indefinidamente
          await colecao.updateOne(
            { _id: valid._id },
            { $set: { acao_validada: "invalida", verificada_em: new Date(), processingBy: null, processingAt: null } }
          );
          processadas++;
          continue;
        }

        // Tenta executar com transação (se suportado). Se falhar por suporte, faz fallback seguro.
        let incrementDone = false;
        const brasilAgora = new Date();
        const offsetBrasilia = -3;
        const brasilMidnightTomorrow = new Date(Date.UTC(
          brasilAgora.getUTCFullYear(),
          brasilAgora.getUTCMonth(),
          brasilAgora.getUTCDate() + 1,
          3, 0, 0, 0
        ));

        // sessão/transação
        let session = null;
        try {
          session = client.startSession();
          await session.withTransaction(async () => {
            // marca ação como incrementado (só se não tiver sido incrementada)
            const resAction = await colecao.updateOne(
              { _id: valid._id, incrementado: { $ne: true } },
              {
                $set: {
                  acao_validada: "valida",
                  incrementado: true,
                  verificada_em: new Date(),
                  processingBy: null,
                  processingAt: null
                }
              },
              { session }
            );

            if (resAction.modifiedCount !== 1) {
              // alguém já processou
              throw new Error("ALREADY_INCREMENTED");
            }

            // incrementa saldo do usuário dentro da transação
            await usuarios.updateOne(
              { _id: new ObjectId(valid.user) },
              { $inc: { saldo: valor } },
              { session }
            );

            // atualiza DailyEarning dentro da transação
            await DailyEarning.updateOne(
              {
                userId: new ObjectId(valid.user),
                expiresAt: brasilMidnightTomorrow,
              },
              {
                $inc: { valor },
                $setOnInsert: { expiresAt: brasilMidnightTomorrow },
              },
              { upsert: true, session }
            );

            // Notificação para smmsociais (fora da transação — não é crítico)
          }, {
            readConcern: { level: "local" },
            writeConcern: { w: "majority" },
            readPreference: "primary"
          });

          // Se chegou aqui sem erro, transação comitou
          incrementDone = true;
        } catch (txErr) {
          if (txErr && txErr.message === "ALREADY_INCREMENTED") {
            console.log("   ⚠ Ação já incrementada por outro job — pulando increment.");
            incrementDone = false;
          } else {
            // Se erro de transação por falta de suporte, faremos fallback
            console.warn("   ⚠ Transação não foi possível ou falhou:", txErr.message || txErr);
          }
        } finally {
          if (session) await session.endSession();
        }

        // Fallback não-transacional (seguro contra duplicação via gate incrementado)
        if (!incrementDone) {
          const upd = await colecao.updateOne(
            { _id: valid._id, incrementado: { $ne: true } },
            {
              $set: {
                acao_validada: "valida",
                incrementado: true,
                verificada_em: new Date(),
                processingBy: null,
                processingAt: null
              }
            }
          );

          if (upd.modifiedCount === 1) {
            // Só quem conseguiu modificar fará o $inc no usuário — evita duplicação
            await usuarios.updateOne(
              { _id: new ObjectId(valid.user) },
              { $inc: { saldo: valor } }
            );

            await DailyEarning.updateOne(
              {
                userId: new ObjectId(valid.user),
                expiresAt: brasilMidnightTomorrow,
              },
              {
                $inc: { valor },
                $setOnInsert: { expiresAt: brasilMidnightTomorrow },
              },
              { upsert: true }
            );

            incrementDone = true;
          } else {
            console.log("   ⚠ Ação já incrementada por outro job (fallback) — pulando increment.");
          }
        }

        if (incrementDone) {
          console.log(`   ✓ Saldo do usuário ${valid.user} incrementado em ${valor} (ação ${valid._id})`);

          // Notifica smmsociais, em background (não bloqueante)
          if (valid.id_pedido) {
            axios.post(
              "https://smmsociais.com/api/incrementar-validadas",
              { id_acao_smm: valid.id_pedido },
              { headers: { Authorization: `Bearer ${process.env.SMM_API_KEY}` } }
            ).then(() => {
              console.log("   ✓ Notificação para smmsociais.com enviada com sucesso.");
            }).catch(err => {
              console.error("   ✗ Erro ao notificar smmsociais.com:", err.response?.data || err.message);
            });
          }
        }

        processadas++;
      } catch (err) {
        console.error(`   ✗ Erro ao processar ação ${acaoDoc._id}:`, err);
        // tenta liberar a claim para não travar indefinidamente
        try {
          await colecao.updateOne(
            { _id: acaoDoc._id, processingBy: JOB_ID },
            { $set: { processingBy: null, processingAt: null, acao_validada: "pendente" } }
          );
        } catch (e) {
          console.warn("   ⚠ Não foi possível liberar claim após erro:", e.message || e);
        }
      }
    } // fim loop claimed

    console.log(`✔ Fim do processamento: ${processadas} ações processadas pelo job ${JOB_ID}.`);
    return res.status(200).json({ status: "ok", processadas });

  } catch (error) {
    console.error("✗ Erro geral em verificar-follows:", error);
    return res.status(500).json({ error: "Erro interno", details: error.message });
  }
}
