// api/verificar-follows.js (ATUALIZADO)
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
  id_pedido: z.string().min(1),
  id_conta: z.string().min(1),
  url_dir: z.string().min(1),
  quantidade_pontos: z.number(),
  valor_confirmacao: z.union([z.string(), z.number()]),
  tipo_acao: z.string().min(1),
  token: z.string().min(1),
});

function normalizeCandidateStrings(v) {
  if (v === undefined || v === null) return null;
  return String(v).trim().toLowerCase();
}

function itemMatchesTarget(item, targetUsernameLower) {
  const candidates = [
    item?.uniqueId,
    item?.unique_id,
    item?.unique,
    item?.user_id,
    item?.userId,
    item?.id,
    item?.uid,
    item?.nickname,
    item?.nick,
    item?.shortId,
  ];

  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    const normalized = normalizeCandidateStrings(c);
    if (!normalized) continue;
    if (normalized === targetUsernameLower) return true;
    if (normalized.replace(/^@/, "") === targetUsernameLower) return true;
  }

  if (typeof item === "object") {
    const nestedValues = Object.values(item).filter(v => typeof v === "string");
    for (const nv of nestedValues) {
      if (normalizeCandidateStrings(nv) === targetUsernameLower) return true;
    }
  }

  return false;
}

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

    console.log("▶ verificar-follows chamado em", new Date().toISOString());

    const db = await connectToDatabase();
    await connectDB();
    const colecao = db.collection("actionhistories");
    const usuarios = db.collection("users");

    const acoes = await colecao.find({
      acao_validada: "pendente",
      tipo: "seguir",
    })
      .sort({ data: 1 })
      .limit(120)
      .toArray();

    console.log(`📦 Encontradas ${acoes.length} ações pendentes.`);

    if (acoes.length === 0) {
      return res.status(200).json({ status: "ok", processadas: 0 });
    }

    let processadas = 0;

    for (const acao of acoes) {
      try {
        const valid = ActionSchema.parse(acao);
        console.log(`— Processando _id=${valid._id}, usuário='${valid.nome_usuario}'`);

        let accountFound = false;
        try {
          const rawIdConta = String(valid.id_conta).trim();
          if (!rawIdConta) throw new Error(`id_conta inválido: ${rawIdConta}`);

          // ---------- 1) Tentar resolver o identificador para um unique username via /user-info ----------
          let identifierToUse = rawIdConta; // fallback: o que já temos
          console.log(`   → Tentando resolver identifier para id_conta='${rawIdConta}' via /user-info`);

          try {
            const infoRes = await axios.get(`${API_URL}/user-info?unique_id=${encodeURIComponent(rawIdConta)}`, {
              headers: { Authorization: `Bearer ${valid.token}` },
              timeout: 10000
            });
            console.log("   → /user-info snippet:", JSON.stringify(infoRes.data)?.substring(0,500));

            // Se /user-info devolveu normalized.user.uniqueId, use-o
            const maybeUnique = infoRes.data?.user?.uniqueId || infoRes.data?.data?.user?.uniqueId || infoRes.data?.provider_raw?.data?.user?.uniqueId;
            const maybeUserId = infoRes.data?.user?.user_id || infoRes.data?.data?.user?.user_id || infoRes.data?.provider_raw?.data?.user?.user_id;

            if (maybeUnique) {
              identifierToUse = String(maybeUnique).trim();
              console.log(`   → Identifier resolvido para uniqueId='${identifierToUse}' (via user-info)`);
            } else if (maybeUserId && String(maybeUserId).trim()) {
              // provider devolveu apenas user_id numérico; em alguns casos o provider aceita isso
              identifierToUse = String(maybeUserId).trim();
              console.log(`   → Identifier resolvido para user_id='${identifierToUse}' (via user-info)`);
            } else {
              console.log("   → /user-info não retornou uniqueId; vamos tentar seguir com o rawIdConta como fallback.");
            }
          } catch (infoErr) {
            console.log("   ✗ /user-info falhou ou não encontrou: ", infoErr.response?.data || infoErr.message);
            // segue com rawIdConta como fallback
          }

          // ---------- 2) Tentar obter followings usando o identifier resolvido ----------
          console.log(`   → Solicitando followings usando identifier='${identifierToUse}'`);
          const followingRes = await axios.get(`${API_URL}/user-following?userId=${encodeURIComponent(identifierToUse)}`, {
            headers: { Authorization: `Bearer ${valid.token}` },
            timeout: 15000
          });

          console.log("   → /user-following response snippet:", JSON.stringify(followingRes.data)?.substring(0,1000));

          // ---------- 3) Extrair array de followings com fallbacks ----------
          let followings =
            followingRes.data?.followings ||
            followingRes.data?.data?.followings ||
            followingRes.data?.data?.list ||
            followingRes.data?.data ||
            followingRes.data ||
            [];

          let list = followings;
          if (!Array.isArray(list) && typeof list === "object") {
            const arrInside = Object.values(list).find(v => Array.isArray(v));
            if (arrInside) list = arrInside;
            else if (Array.isArray(list?.users)) list = list.users;
          }

          // ---------- 4) Se provider retornou "Username doesn't exist", tentar fallback com outro identifier ----------
          const providerMsgString = JSON.stringify(followingRes.data || "");
          if (providerMsgString.toLowerCase().includes("username doesn't exist") || providerMsgString.toLowerCase().includes("user not found")) {
            console.log("   → Provider diz 'username doesn't exist' para identifier usado. Tentando fallback(s).");

            // Fallback 1: se identifierToUse é numeric, tente com rawIdConta (se diferente)
            if (identifierToUse !== rawIdConta) {
              try {
                console.log(`   → Tentativa fallback com rawIdConta='${rawIdConta}'`);
                const fallbackRes = await axios.get(`${API_URL}/user-following?userId=${encodeURIComponent(rawIdConta)}`, {
                  headers: { Authorization: `Bearer ${valid.token}` },
                  timeout: 15000
                });
                console.log("   → fallback response snippet:", JSON.stringify(fallbackRes.data)?.substring(0,1000));
                // re-extrai lista do fallback
                followings =
                  fallbackRes.data?.followings ||
                  fallbackRes.data?.data?.followings ||
                  fallbackRes.data?.data?.list ||
                  fallbackRes.data?.data ||
                  fallbackRes.data ||
                  [];
                list = followings;
                if (!Array.isArray(list) && typeof list === "object") {
                  const arrInside2 = Object.values(list).find(v => Array.isArray(v));
                  if (arrInside2) list = arrInside2;
                }
              } catch (fbErr) {
                console.log("   ✗ Fallback com rawIdConta falhou:", fbErr.response?.data || fbErr.message);
              }
            }

            // Fallback 2: (opcional) — você pode tentar outros formatos aqui (sec_user_id, etc.)
          }

          // ---------- 5) Se list é array, buscar o target ----------
          if (!Array.isArray(list)) {
            console.log("   ⚠ followingRes não contém array de followings; list type:", typeof list);
            accountFound = false;
          } else {
            const match = valid.url_dir.toLowerCase().match(/@([\w_.]+)/);
            const targetUsername = match ? match[1] : valid.url_dir.replace(/^@/, "").toLowerCase();
            const targetLower = targetUsername.toLowerCase();

            accountFound = list.some(item => itemMatchesTarget(item, targetLower));
            console.log(`   → target=${targetLower} accountFound=${accountFound} (lista tamanho=${list.length})`);
          }
        } catch (e) {
          console.error("   ✗ Falha em /user-following/fallbacks:", e.response?.data || e.message || e);
          accountFound = false;
        }

        const storedStatus = accountFound ? "valida" : "invalida";

        await colecao.updateOne(
          { _id: new ObjectId(valid._id) },
          { $set: { acao_validada: storedStatus, verificada_em: new Date() } }
        );

        if (accountFound) {
          const valor = parseFloat(valid.valor_confirmacao);
          if (!isNaN(valor) && valor > 0) {
            await usuarios.updateOne({ _id: new ObjectId(valid.user) }, { $inc: { saldo: valor } });
            console.log(`   ✓ Saldo do usuário ${valid.user} incrementado em ${valor}`);

            // DailyEarning update (mantive sua lógica)
            const agora = new Date();
            const offsetBrasilia = -3;
            const brasilAgora = new Date(agora.getTime() + offsetBrasilia * 60 * 60 * 1000);
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

            if (valid.id_pedido) {
              try {
                await axios.post(
                  "https://smmsociais.com/api/incrementar-validadas",
                  { id_acao_smm: valid.id_pedido },
                  { headers: { Authorization: `Bearer ${process.env.SMM_API_KEY}` } }
                );
                console.log("   ✓ Notificação para smmsociais.com enviada com sucesso.");
              } catch (err) {
                console.error("   ✗ Erro ao notificar smmsociais.com:", err.response?.data || err.message);
              }
            }

            console.log(`   ✓ Saldo e dailyearning atualizados para o usuário ${valid.user} em R$${valor}`);
          } else {
            console.warn(`   ⚠ valor_confirmacao inválido para ação ${valid._id}:`, valid.valor_confirmacao);
          }
        } else {
          console.log(`   ✗ Ação ${valid._id} considerada INÁLIDA (accountFound=false)`);
        }

        console.log(`   ✓ Ação ${valid._id} atualizada: acao_validada=${storedStatus}`);
        processadas++;
      } catch (err) {
        console.error(`   ✗ Erro ao processar ação ${acao._id}:`, err);
      }
    }

    console.log(`✔ Fim do processamento: ${processadas} ações processadas.`);
    return res.status(200).json({ status: "ok", processadas });
  } catch (error) {
    console.error("✗ Erro geral em verificar-follows:", error);
    return res.status(500).json({ error: "Erro interno", details: error.message });
  }
}
