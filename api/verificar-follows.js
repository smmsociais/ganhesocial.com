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
  // tenta vários campos possíveis que podem existir no objeto de following
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
    item?.shortId, // caso
  ];

  for (const c of candidates) {
    if (!c && c !== 0) continue;
    const normalized = normalizeCandidateStrings(c);
    if (!normalized) continue;
    // geralmente targetUsername é sem @ e lowercased
    if (normalized === targetUsernameLower) return true;
    // alguns providers retornam nomes com '@' ou com domínio; remove leading @
    if (normalized.replace(/^@/, "") === targetUsernameLower) return true;
  }

  // alguns itens podem ter um objeto 'unique' ou 'profile' dentro
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
    await connectDB(); // ⬅️ garante conexão Mongoose para o modelo DailyEarning
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
          const idConta = String(valid.id_conta).trim();
          if (!idConta || typeof idConta !== "string") throw new Error(`id_conta inválido: ${idConta}`);

          // Chamada ao seu endpoint que retorna a lista de followings
          const followingRes = await axios.get(`${API_URL}/user-following?userId=${encodeURIComponent(idConta)}`, {
            headers: { Authorization: `Bearer ${valid.token}` },
            timeout: 15000
          });

          // LOG: grava trecho do retorno para depuração (visível na Vercel)
          console.log("   → /user-following response snippet:", JSON.stringify(followingRes.data)?.substring(0, 1000));

          // EXTRAI array de followings com vários fallbacks possíveis (compatível com seu handler)
          const followings =
            followingRes.data?.followings ||
            followingRes.data?.data?.followings ||
            followingRes.data?.data?.list ||
            followingRes.data?.data ||
            followingRes.data?.followings ||
            followingRes.data ||
            [];

          // Se for um objeto que contém arrays em subcampos, tenta achar o primeiro array
          let list = followings;
          if (!Array.isArray(list) && typeof list === "object") {
            const arrInside = Object.values(list).find(v => Array.isArray(v));
            if (arrInside) list = arrInside;
            // se list ainda for objeto e tiver 'users' ou 'users_list', tente extrair
            else if (Array.isArray(list?.users)) list = list.users;
          }

          if (!Array.isArray(list)) {
            console.log("   ⚠ followingRes não contém array de followings; list type:", typeof list);
            // continue para próxima ação (considera inválido temporariamente)
            accountFound = false;
          } else {
            // extrai target username do url_dir (como você já faz)
            const match = valid.url_dir.toLowerCase().match(/@([\w_.]+)/);
            const targetUsername = match ? match[1] : valid.url_dir.replace(/^@/, "").toLowerCase();
            const targetLower = targetUsername.toLowerCase();

            // percorre os followings tentando casar por vários campos
            accountFound = list.some(item => itemMatchesTarget(item, targetLower));

            console.log(`   → target=${targetLower} accountFound=${accountFound} (lista tamanho=${list.length})`);
          }
        } catch (e) {
          console.error("   ✗ Falha em /user-following:", e.message || e);
          // se falhar nesta verificação, marca como não encontrado mas não interrompe o loop
          accountFound = false;
        }

        // guarda o status que será salvo
        const storedStatus = accountFound ? "valida" : "invalida";

        await colecao.updateOne(
          { _id: new ObjectId(valid._id) },
          { $set: { acao_validada: storedStatus, verificada_em: new Date() } }
        );

        if (accountFound) {
          const valor = parseFloat(valid.valor_confirmacao);
          if (!isNaN(valor) && valor > 0) {
            await usuarios.updateOne(
              { _id: new ObjectId(valid.user) },
              { $inc: { saldo: valor } }
            );
            console.log(`   ✓ Saldo do usuário ${valid.user} incrementado em ${valor}`);

            // cálculo de expiresAt e update de DailyEarning (mantive sua lógica)
            const agora = new Date();
            console.log("🕒 Agora (UTC):", agora.toISOString());

            const offsetBrasilia = -3;
            const brasilAgora = new Date(agora.getTime() + offsetBrasilia * 60 * 60 * 1000);
            const brasilMidnightTomorrow = new Date(Date.UTC(
              brasilAgora.getUTCFullYear(),
              brasilAgora.getUTCMonth(),
              brasilAgora.getUTCDate() + 1,
              3, 0, 0, 0
            ));

            await DailyEarning.updateOne(
              {
                userId: new ObjectId(valid.user),
                expiresAt: brasilMidnightTomorrow,
              },
              {
                $inc: { valor },
                $setOnInsert: {
                  expiresAt: brasilMidnightTomorrow,
                },
              },
              { upsert: true }
            );

            console.log(`   ✓ Saldo e dailyearning atualizados para o usuário ${valid.user} em R$${valor}`);
          } else {
            console.warn(`   ⚠ valor_confirmacao inválido para ação ${valid._id}:`, valid.valor_confirmacao);
          }

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
