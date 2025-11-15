import axios from "axios";
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import connectDB from "../db.js";
import nodemailer from 'nodemailer';
import { sendRecoveryEmail } from "../mailer.js";
import crypto from "crypto";
import { User, ActionHistory, DailyEarning, Pedido, TemporaryAction, DailyRanking } from "../schema.js";

// ===== Variáveis globais (colocar no topo do arquivo, fora do handler) =====
let ultimoRanking = null;
let ultimaAtualizacao = 0;
let top3FixosHoje = null;
let diaTop3 = null;
let horaInicioRanking = null;
let zeroedAtMidnight = false;
let dailyFixedRanking = null;

// --- Helpers de fuso e formatos (consistentes) -----------------
function hojeBRString(date = new Date()) {
return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza' }).format(date);
}
function startAtForBRDay(date = new Date()) {
const br = new Date(date.toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
return new Date(Date.UTC(br.getFullYear(), br.getMonth(), br.getDate(), 3, 0, 0, 0));
}
function midnightExpiresBR(date = new Date()) {
const br = new Date(date.toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
return new Date(Date.UTC(br.getFullYear(), br.getMonth(), br.getDate() + 1, 3, 0, 0, 0));
}

// util: normaliza username para comparações
const norm = (s) => String(s || '').trim().toLowerCase();

// util: shuffle in-place
function shuffleArray(arr) {
for (let i = arr.length - 1; i > 0; i--) {
const j = Math.floor(Math.random() * (i + 1));
[arr[i], arr[j]] = [arr[j], arr[i]];
}
return arr;
}

// Ensure unique index on 'data' once per process
let _indexEnsured = false;
async function ensureUniqueDataIndexOnce() {
if (_indexEnsured) return;
try {
await DailyRanking.collection.createIndex({ data: 1 }, { unique: true });
_indexEnsured = true;
console.log('✅ Índice único criado/confirmado para DailyRanking.data');
} catch (e) {
if (e && (e.code === 11000 || e.codeName === 'IndexKeySpecsConflict')) {
_indexEnsured = true; // outro processo já criou
} else {
console.warn('⚠️ Falha ao garantir índice único DailyRanking.data (ignorado):', e && e.message ? e.message : e);
}
}
}


// createOrGetDailyRanking: atômico com $setOnInsert; trata E11000
async function createOrGetDailyRanking(dataKey, payload = {}) {
const filter = { data: dataKey };
const update = {
$setOnInsert: {
ranking: payload.ranking || [],
startAt: payload.startAt || new Date(),
expiresAt: payload.expiresAt || null,
criadoEm: payload.criadoEm || new Date()
}
};
const opts = { upsert: true, new: true, setDefaultsOnInsert: true };


try {
const doc = await DailyRanking.findOneAndUpdate(filter, update, opts).lean();
return doc;
} catch (err) {
if (err && (err.code === 11000 || err.codeName === 'DuplicateKey')) {
// corrida detectada — retorna o existente
const existing = await DailyRanking.findOne(filter).lean();
if (existing) return existing;
}
throw err;
}
}

// fallback implementation caso a função externa fetchTopFromDailyEarning não exista
async function safeFetchTopFromDailyEarning(limit = 10) {
try {
// tenta implementar com a coleção DailyEarning/Users
const agg = await DailyEarning.aggregate([
{ $group: { _id: '$userId', totalGanhos: { $sum: '$valor' } } },
{ $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'usuario' } },
{ $unwind: { path: '$usuario', preserveNullAndEmptyArrays: true } },
{ $project: { userId: '$_id', username: { $ifNull: ['$usuario.nome', 'Usuário'] }, token: { $ifNull: ['$usuario.token', null] }, real_total: '$totalGanhos' } },
{ $sort: { real_total: -1 } },
{ $limit: limit }
]).exec();
return (agg || []).map(x => ({ username: x.username, token: x.token || null, real_total: Number(x.real_total || 0), userId: x.userId ? String(x.userId) : null }));
} catch (e) {
console.warn('safeFetchTopFromDailyEarning falhou:', e && e.message ? e.message : e);
return [];
}
}

// valores baseline — use os seus valores se já existirem no arquivo
const baselineValores = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3];
const fillerNames = [
'Allef 🔥','🤪','-','noname','⚡','💪','-','KingdosMTD🥱🥱','kaduzinho',
'Rei do ttk 👑','Deus🔥','Mago ✟','-','ldzz tiktok uva🍇','unknown',
'vitor das continhas','-','@_01.kaio0','Lipe Rodagem Interna 😄','-','dequelbest 🧙','Luiza','-','xxxxxxxxxx',
'Bruno TK','-','[GODZ] MK ☠️','[GODZ] Leozin ☠️','Junior','Metheus Rangel','Hackerzin☯','VIP++++','sagaz🐼','-'
];

// util: formatar valor (mantive sua função)
function formatarValorRanking(valor) {
try {
const v = Number(valor || 0);
if (v <= 1) return '1+';
if (v > 1 && v < 5) return '1+';
if (v < 10) return '5+';
if (v < 50) return '10+';
if (v < 100) return '50+';
if (v < 500) return '100+';
return '500+';
} catch (e) { return '1+'; }
}

export default async function handler(req, res) {
    const { method, url, query } = req;

    // 🚨 RESET MANUAL DO RANKING (via variável de ambiente OU parâmetro na URL)
    const resetPorEnv = process.env.RESET_RANKING === 'true';
    const resetPorURL = query?.reset === 'true';

if (resetPorEnv || resetPorURL) {
    await connectDB(); // garante conexão antes de limpar o banco

    // 🧹 Limpa todos os ganhos diários (zera saldos)
    const resultado = await DailyEarning.deleteMany({});
    console.log(`🧾 ${resultado.deletedCount} registros de ganhos diários removidos.`);

    // 🧠 Limpa cache do ranking
    ultimoRanking = null;
    ultimaAtualizacao = 0;
    top3FixosHoje = null;
    diaTop3 = null;
    horaInicioRanking = Date.now();
    console.log("🔥 Ranking e saldos reiniciados manualmente", resetPorEnv ? "(via ENV)" : "(via URL)");

    if (resetPorURL) {
        return res.status(200).json({
            success: true,
            message: `Ranking e saldos zerados (${resultado.deletedCount} ganhos removidos).`
        });
    }
}
    async function salvarAcaoComLimitePorUsuario(novaAcao) {
        const LIMITE = 2000;
        const total = await ActionHistory.countDocuments({ user: novaAcao.user });

        if (total >= LIMITE) {
            const excess = total - LIMITE + 1;
            await ActionHistory.find({ user: novaAcao.user })
                .sort({ createdAt: 1 })
                .limit(excess)
                .deleteMany();
        }

        await novaAcao.save();
    }

// garante helper acessível mesmo em hot-reload / diferentes escopos
if (typeof globalThis.fetchTopFromDailyEarning !== "function") {
  globalThis.fetchTopFromDailyEarning = async function(limit = 10) {
    try {
      const ganhos = await DailyEarning.aggregate([
        { $group: { _id: "$userId", totalGanhos: { $sum: "$valor" } } },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "usuario" } },
        { $unwind: { path: "$usuario", preserveNullAndEmptyArrays: true } },
        { $project: {
            userId: "$_id",
            username: { $ifNull: ["$usuario.nome", "Usuário"] },
            token: { $ifNull: ["$usuario.token", null] },
            real_total: "$totalGanhos"
        }},
        { $sort: { real_total: -1 } },
        { $limit: limit }
      ]);

      return ganhos.map(g => ({
        username: g.username || "Usuário",
        token: g.token || null,
        real_total: Number(g.real_total || 0),
        userId: g.userId ? String(g.userId) : null,
        source: "earnings"
      }));
    } catch (e) {
      console.error("Erro fetchTopFromDailyEarning:", e);
      return [];
    }
  };
}
const fetchTopFromDailyEarning = globalThis.fetchTopFromDailyEarning;

    // Rota: /api/vincular_conta (POST)
    if (url.startsWith("/api/vincular_conta") && method === "POST") {
        const { nomeUsuario } = req.body;

        if (!nomeUsuario) {
            return res.status(400).json({ error: "Nome de usuário é obrigatório." });
        }

        const urlBind = `http://api.ganharnoinsta.com/bind_tk.php?token=944c736c-6408-465d-9129-0b2f11ce0971&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nomeUsuario}`;

        try {
const { data } = await axios.get(urlBind);
console.log("Resposta da API externa bind_tk.php:", data);

if (data.status === "success") {
    return res.status(200).json({ id_conta: data.id_conta });
} else {
    // Retorna o erro real da API externa para o frontend para facilitar debug
    return res.status(400).json({ error: data.message || "Erro ao vincular conta." });
}
        } catch (error) {
            console.error("Erro ao vincular conta:", error);
            return res.status(500).json({ error: "Erro interno ao vincular conta." });
        }
    }

    // Rota: /api/buscar_acao (GET)
if (url.startsWith("/api/buscar_acao") && method === "GET") {
    const { id_conta } = req.query;

    if (!id_conta) {
        return res.status(400).json({ error: "ID da conta é obrigatório." });
    }

    const urlAction = `https://api.ganharnoinsta.com/get_action.php?token=944c736c-6408-465d-9129-0b2f11ce0971&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&id_conta=${id_conta}&is_tiktok=1&tipo=1`;

    try {
        await connectDB();

        const { data } = await axios.get(urlAction);

        if (data.status === "ENCONTRADA") {
            const { id_pedido } = data;

            // ⛔ Verifica se o usuário pulou essa ação
            const pulada = await ActionHistory.findOne({
                id_pedido,
                id_conta,
                acao_validada: 'pulada',
            });

            if (pulada) {
                // Ação já foi pulada, retorna sem conteúdo ou ignora
                return res.status(204).end(); // ou tente buscar outra
            }

            return res.status(200).json({
                ...data,
                unique_id: data.unique_id || null
            });
        } else {
            return res.status(200).json({ error: "Nenhuma ação encontrada." });
        }
    } catch (error) {
        console.error("Erro ao buscar ação:", error);
        return res.status(500).json({ error: "Erro ao buscar ação." });
    }
}

// Rota: /api/confirmar_acao (POST)
if (url.startsWith("/api/confirmar_acao") && method === "POST") {
    try {
        const { id_conta, id_pedido } = req.body;

        if (!id_conta || !id_pedido) {
            return res.status(400).json({ error: "ID da conta e ID do pedido são obrigatórios." });
        }

        const confirmUrl = "https://api.ganharnoinsta.com/confirm_action.php";

        const payload = {
            token: "944c736c-6408-465d-9129-0b2f11ce0971",
            sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
            id_conta,
            id_pedido,
            is_tiktok: "1"
        };

        const confirmResponse = await axios.post(confirmUrl, payload, {
            headers: { "Content-Type": "application/json" }
        });

        if (confirmResponse.data.status !== "success") {
            return res.status(400).json({ error: "Erro ao confirmar ação.", detalhes: confirmResponse.data });
        }

        return res.status(200).json({
            status: "success",
            message: "CONFIRMOU_SUCESSO",
            valor: confirmResponse.data.valor
        });

    } catch (error) {
        console.error("Erro na requisição confirm_action:", error.response?.data || error.message);
        return res.status(500).json({ error: "Erro na requisição confirm_action.", detalhes: error.response?.data });
    }
}

// Rota: /api/contas (GET, POST, DELETE)
if (url.startsWith("/api/test/contas")) {
    try {
        await connectDB();

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: "Acesso negado, token não encontrado." });

        const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
        console.log("🔹 Token recebido:", token);

        if (!token) return res.status(401).json({ error: "Token inválido." });

        const user = await User.findOne({ token });
        if (!user) return res.status(404).json({ error: "Usuário não encontrado ou token inválido." });

if (method === "POST") {
    const { nomeConta, id_conta, id_tiktok } = req.body;

    if (!nomeConta) {
        return res.status(400).json({ error: "Nome da conta é obrigatório." });
    }

    // Normaliza o nome para comparação/unicidade
    const nomeNormalized = String(nomeConta).trim();

    // 🔍 Verifica se a conta já existe neste próprio usuário
    const contaExistente = user.contas.find(c => c.nomeConta === nomeNormalized);

    if (contaExistente) {
        if (contaExistente.status === "ativa") {
            return res.status(400).json({ error: "Esta conta já está ativa." });
        }

        // ✅ Reativar a conta (mantemos lógica atual)
        contaExistente.status = "ativa";
        contaExistente.id_conta = id_conta ?? contaExistente.id_conta;
        contaExistente.id_tiktok = id_tiktok ?? contaExistente.id_tiktok;
        contaExistente.dataDesativacao = undefined;

        await user.save();
        return res.status(200).json({ message: "Conta reativada com sucesso!" });
    }

    // 🔒 Verifica se nome já está em uso por outro usuário
    const contaDeOutroUsuario = await User.findOne({
        _id: { $ne: user._id },
        "contas.nomeConta": nomeNormalized
    });

    if (contaDeOutroUsuario) {
        return res.status(400).json({ error: "Já existe uma conta com este nome de usuário." });
    }

// === Validação prévia: consulta a API externa / bind ===
try {
    const bindUrl = `http://api.ganharnoinsta.com/bind_tk.php?token=944c736c-6408-465d-9129-0b2f11ce0971&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${encodeURIComponent(nomeNormalized)}`;

    const bindResp = await fetch(bindUrl, { method: 'GET', timeout: 8000 });
    const bindText = String(await bindResp.text()).trim();
    const bindUpper = bindText.toUpperCase();

    console.log("🔍 Resposta do bind:", bindText);

    // ❗ SE A API RETORNAR NOT_FOUND → NÃO ADICIONAR A CONTA
    if (bindUpper.includes("NOT_FOUND")) {
        return res.status(200).json({
            error: "Não conseguimos encontrar o seu perfil. Verifique se o nome de usuário está correto e tente novamente."
        });
    }

    // ❗ QUALQUER OUTRO ERRO → IGNORAR E ADICIONAR A CONTA MESMO ASSIM
    // Ou seja, só não adiciona se for NOT_FOUND.
} catch (bindError) {
    console.error("⚠ Erro ao validar bind (IGNORADO, conta será adicionada):", bindError);
    // ❗ Não retornamos erro → continua fluxo e cria a conta normalmente
}

    // ➕ Adiciona nova conta (somente chega aqui se bind foi OK)
    user.contas.push({ nomeConta: nomeNormalized, id_conta, id_tiktok, status: "ativa" });
    await user.save();

    return res.status(201).json({ message: "Conta adicionada com sucesso!", nomeConta: nomeNormalized });
}
        if (method === "GET") {
            if (!user.contas || user.contas.length === 0) {
                return res.status(200).json([]);
            }

            // Filtra contas ativas (ou sem status) e mapeia para objeto plano com dados do usuário
            const contasAtivas = user.contas
                .filter(conta => !conta.status || conta.status === "ativa")
                .map(conta => {
                    // se for documento Mongoose, transforma em objeto JS plano
                    const contaObj = typeof conta.toObject === "function" ? conta.toObject() : conta;
                    return {
                        ...contaObj,
                        usuario: {
                            _id: user._id,
                            nome: user.nome
                        }
                    };
                });

            return res.status(200).json(contasAtivas);
        }

        if (method === "DELETE") {
            const { nomeConta } = req.query;
            if (!nomeConta) {
                return res.status(400).json({ error: "Nome da conta não fornecido." });
            }

            console.log("🔹 Nome da conta recebido para exclusão:", nomeConta);

            const contaIndex = user.contas.findIndex(conta => conta.nomeConta === nomeConta);

            if (contaIndex === -1) {
                return res.status(404).json({ error: "Conta não encontrada." });
            }

            user.contas[contaIndex].status = "inativa";
            user.contas[contaIndex].dataDesativacao = new Date();
            await user.save();

            return res.status(200).json({ message: `Conta ${nomeConta} desativada com sucesso.` });
        }

    } catch (error) {
        console.error("❌ Erro:", error);
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
}

// Rota: /api/profile (GET ou PUT)
if (url.startsWith("/api/profile")) {
  if (method !== "GET" && method !== "PUT") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const token = authHeader.split(" ")[1].trim();
  console.log("🔐 Token recebido:", token);

  try {
    const usuario = await User.findOne({ token });
    if (!usuario) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    if (method === "GET") {
      let actionHistory = null;

      if (usuario.historico_acoes?.length > 0) {
        actionHistory = await ActionHistory.findOne({
          _id: { $in: usuario.historico_acoes }
        }).sort({ data: -1 });
      }

      return res.status(200).json({
        nome_usuario: usuario.nome,
        email: usuario.email,
        token: usuario.token
      });
    }

    if (method === "PUT") {
      const { nome_usuario, email, senha } = req.body;

      const updateFields = { nome: nome_usuario, email };
      if (senha) {
        updateFields.senha = senha; // ⚠️ Criptografar se necessário
      }

      const usuarioAtualizado = await User.findOneAndUpdate(
        { token },
        updateFields,
        { new: true }
      );

      if (!usuarioAtualizado) {
        return res.status(404).json({ error: "Usuário não encontrado." });
      }

      return res.status(200).json({ message: "Perfil atualizado com sucesso!" });
    }
  } catch (error) {
    console.error("💥 Erro ao processar /profile:", error);
    return res.status(500).json({ error: "Erro ao processar perfil." });
  }
}

// Rota: /api/historico_acoes (GET)
if (url.startsWith("/api/historico_acoes")) {
  if (method !== "GET") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token não fornecido ou inválido." });
  }

  const token = authHeader.split(" ")[1];
  const usuario = await User.findOne({ token });

  if (!usuario) {
    return res.status(401).json({ error: "Usuário não autenticado." });
  }

  const nomeUsuarioParam = req.query.usuario;

  if (nomeUsuarioParam) {
    // Busca diretamente pelo nome de usuário, ignorando o token
    const historico = await ActionHistory
      .find({ nome_usuario: nomeUsuarioParam, acao_validada: { $ne: "pulada" } })
      .sort({ data: -1 });
  
    const formattedData = historico.map(action => {
      let status;
      if (action.acao_validada === "valida") status = "Válida";
      else if (action.acao_validada === "invalida") status = "Inválida";
      else status = "Pendente";
  
      return {
        nome_usuario: action.nome_usuario,
        acao_validada: action.acao_validada,
        valor_confirmacao: action.valor_confirmacao,
        data: action.data,
        rede_social: action.rede_social || "TikTok",
        tipo: action.tipo || "Seguir",
        url_dir: action.url_dir || null,
        status
      };
    });
  
    return res.status(200).json(formattedData);
  }  

  try {
    const historico = await ActionHistory
      .find({ user: usuario._id, acao_validada: { $ne: "pulada" } })
      .sort({ data: -1 });

    const formattedData = historico.map(action => {
      let status;
      if (action.acao_validada === "valida") status = "Válida";
      else if (action.acao_validada === "invalida") status = "Inválida";
      else status = "Pendente";

      return {
        nome_usuario: action.nome_usuario,
        acao_validada: action.acao_validada,
        valor_confirmacao: action.valor_confirmacao,
        data: action.data,
        rede_social: action.rede_social || "TikTok",
        tipo: action.tipo || "Seguir",
        url_dir: action.url_dir || null,
        status
      };
    });    

    return res.status(200).json(formattedData);
  } catch (error) {
    console.error("💥 Erro em /historico_acoes:", error);
    return res.status(500).json({ error: "Erro ao buscar histórico de ações." });
  }
}

// Rota: /api/get_saldo (GET)
if (url.startsWith("/api/get_saldo")) {
    if (method !== "GET") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    const { token } = req.query;
    if (!token) {
        return res.status(400).json({ error: "Token obrigatório." });
    }

    try {
        const usuario = await User.findOne({ token }).select("saldo pix_key _id");
        if (!usuario) {
            return res.status(403).json({ error: "Acesso negado." });
        }
        
        // calcula o saldo pendente com base nas ações ainda não validadas
        const pendentes = await ActionHistory.find({
            user: usuario._id,
            acao_validada: "pendente"
        }).select("valor_confirmacao");
        
        const saldo_pendente = pendentes.reduce((soma, acao) => soma + (acao.valor_confirmacao || 0), 0);
        
        return res.status(200).json({
            saldo_disponivel: typeof usuario.saldo === "number" ? usuario.saldo : 0,
            saldo_pendente,
            pix_key: usuario.pix_key
        });
        
    } catch (error) {
        console.error("💥 Erro ao obter saldo:", error);
        return res.status(500).json({ error: "Erro ao buscar saldo." });
    }
}

// Rota: /api/login
if (url.startsWith("/api/login")) {
        if (req.method !== "POST") {
            return res.status(405).json({ error: "Método não permitido" });
        }
    
        try {
            await connectDB();
    
            const { email, senha } = req.body;
    
            if (!email || !senha) {
                return res.status(400).json({ error: "E-mail e senha são obrigatórios!" });
            }
    
            console.log("🔍 Buscando usuário no banco de dados...");
            const usuario = await User.findOne({ email });
    
            if (!usuario) {
                console.log("🔴 Usuário não encontrado!");
                return res.status(400).json({ error: "Usuário não encontrado!" });
            }
    
            if (senha !== usuario.senha) {
                console.log("🔴 Senha incorreta!");
                return res.status(400).json({ error: "Senha incorreta!" });
            }
    
            let token = usuario.token;
            if (!token) {
                token = jwt.sign({ id: usuario._id }, process.env.JWT_SECRET);
                usuario.token = token;
                await usuario.save({ validateBeforeSave: false });
  
                console.log("🟢 Novo token gerado e salvo.");
            } else {
                console.log("🟢 Token já existente mantido.");
            }
    
            console.log("🔹 Token gerado para usuário:", token);
            return res.json({ message: "Login bem-sucedido!", token });
    
        } catch (error) {
            console.error("❌ Erro ao realizar login:", error);
            return res.status(500).json({ error: "Erro ao realizar login" });
        }
    };

if (url.startsWith("/api/signup") && method === "POST") {
  await connectDB();

  const { email, senha, ref } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ error: "Todos os campos são obrigatórios." });
  }

  try {

    // ✅ Verifica se e-mail já existe
    const emailExiste = await User.findOne({ email });
    if (emailExiste) return res.status(400).json({ error: "E-mail já cadastrado." });

    // ✅ Gera token obrigatório
    const token = crypto.randomBytes(32).toString("hex");

    // ✅ Função para gerar código de afiliado numérico (8 dígitos)
    const gerarCodigo = () =>
      Math.floor(10000000 + Math.random() * 90000000).toString();

    // Retentativa para evitar colisão de código
    const maxRetries = 5;
    let attempt = 0;
    let savedUser = null;

    while (attempt < maxRetries && !savedUser) {
      const codigo_afiliado = gerarCodigo();

      // Novo usuário
      const ativo_ate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 dias de ativo
      const novoUsuario = new User({
        email,
        senha,
        token,
        codigo_afiliado,
        status: "ativo",
        ativo_ate,
        indicado_por: ref || null, // vincula ao código do afiliado, se houver
      });

      try {
        savedUser = await novoUsuario.save();
      } catch (err) {
        if (err?.code === 11000 && err.keyPattern?.codigo_afiliado) {
          console.warn(`[SIGNUP] Colisão codigo_afiliado (tentativa ${attempt + 1}). Gerando novo código.`);
          attempt++;
          continue;
        }
        throw err;
      }
    }

    if (!savedUser) {
      return res.status(500).json({ error: "Não foi possível gerar um código de afiliado único. Tente novamente." });
    }

    return res.status(201).json({
      message: "Usuário registrado com sucesso!",
      token: savedUser.token,
      codigo_afiliado: savedUser.codigo_afiliado,
      id: savedUser._id,
    });

  } catch (error) {
    console.error("Erro ao cadastrar usuário:", error);
    if (error?.code === 11000 && error.keyPattern?.email) {
      return res.status(400).json({ error: "E-mail já cadastrado." });
    }
    return res.status(500).json({ error: "Erro interno ao registrar usuário. Tente novamente mais tarde." });
  }
}

// Rota: /api/change-password
if (url.startsWith("/api/change-password")) {
        if (req.method !== "POST") {
            return res.status(405).json({ error: "Método não permitido" });
        }
    
        try {
            await connectDB();
            console.log("Conectado ao MongoDB via Mongoose");
    
            const authHeader = req.headers.authorization || "";
            console.log("📩 Cabeçalho Authorization recebido:", authHeader);
    
            const token = authHeader.replace("Bearer ", "").trim();
            console.log("🔐 Token extraído:", token);
    
            if (!token) {
                return res.status(401).json({ error: "Token ausente" });
            }
    
            // Buscar o usuário com o token
            const usuario = await User.findOne({ resetPasswordToken: token });
    
            if (!usuario) {
                console.log("❌ Token inválido ou usuário não encontrado!");
                return res.status(401).json({ error: "Token inválido" });
            }
    
            // (Opcional) Validar se o token expirou
            const expiracao = usuario.resetPasswordExpires ? new Date(usuario.resetPasswordExpires) : null;
            if (expiracao && expiracao < new Date()) {
                console.log("❌ Token expirado!");
                return res.status(401).json({ error: "Token expirado" });
            }
    
            const { novaSenha } = req.body;
    
            if (!novaSenha) {
                return res.status(400).json({ error: "Nova senha é obrigatória" });
            }
    
            // Alterar a senha
            usuario.senha = novaSenha;
    
            // Limpar o token após a redefinição da senha
    usuario.resetPasswordToken = null;
    usuario.resetPasswordExpires = null;
    
            await usuario.save();
    
            console.log("✅ Senha alterada com sucesso para o usuário:", usuario.email);
            return res.json({ message: "Senha alterada com sucesso!" });
    
        } catch (error) {
            console.error("❌ Erro ao alterar senha:", error);
            return res.status(500).json({ error: "Erro ao alterar senha" });
        }
    }; 

 // Rota: /api/recover-password
if (url.startsWith("/api/recover-password")) { 
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método não permitido" });

  const { email } = req.body;
  if (!email)
    return res.status(400).json({ error: "Email é obrigatório" });

  try {
    await connectDB(); // só garante a conexão
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user)
      return res.status(404).json({ error: "Email não encontrado" });

    const token = crypto.randomBytes(32).toString("hex");
    
    const expires = Date.now() + 30 * 60 * 1000; // 30 minutos em milissegundos

    // Salva no documento Mongoose
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(expires);
    await user.save();

    const link = `https://ganhesocial.com/reset-password?token=${token}`;
    await sendRecoveryEmail(email, link);

    return res.status(200).json({ message: "Link enviado com sucesso" });
  } catch (err) {
    console.error("Erro em recover-password:", err);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
}

 // Rota: api/validate-reset-token
 if (url.startsWith("/api/validate-reset-token")) { 
        if (req.method !== "GET") {
            return res.status(405).json({ error: "Método não permitido" });
        }
    
        try {
            await connectDB();
            const token = req.query.token;
    
            if (!token) {
                return res.status(400).json({ error: "Token ausente" });
            }
    
            const usuario = await User.findOne({ resetPasswordToken: token });
    
            if (!usuario) {
                return res.status(401).json({ error: "Link inválido ou expirado" });
            }
    
            // Obtenha a data de expiração de forma consistente
            const expiracao = usuario.resetPasswordExpires;
    
            if (!expiracao) {
                return res.status(401).json({ error: "Data de expiração não encontrada" });
            }
    
            // Log para ver a data de expiração
            console.log("Data de expiração do token:", expiracao);
    
            // Data atual em UTC
            const agora = new Date().toISOString();
    
            // Log para ver a data atual
            console.log("Data atual (agora):", agora);
    
            // Converter para milissegundos desde 1970
            const expiracaoMs = new Date(expiracao).getTime();
            const agoraMs = new Date(agora).getTime();
    
            // Log para ver as datas em milissegundos
            console.log("Expiração em milissegundos:", expiracaoMs);
            console.log("Agora em milissegundos:", agoraMs);
    
            // Se a data atual for maior que a data de expiração, o token expirou
            if (agoraMs > expiracaoMs) {
                console.log("Token expirado.");
                return res.status(401).json({ error: "Link inválido ou expirado" });
            }
    
            // Se o token ainda estiver dentro do prazo de validade
            return res.json({ valid: true });
    
        } catch (error) {
            return res.status(500).json({ error: "Erro ao validar token" });
        }
    };

// 🔹 Rota: /api/withdraw
if (url.startsWith("/api/withdraw")) {
  if (method !== "GET" && method !== "POST") {
    console.log("[DEBUG] Método não permitido:", method);
    return res.status(405).json({ error: "Método não permitido." });
  }

  const OPENPIX_API_KEY = process.env.OPENPIX_API_KEY;
  const OPENPIX_API_URL = process.env.OPENPIX_API_URL || "https://api.openpix.com.br";

  // conecta DB (assume função global connectDB e modelo User)
  await connectDB();

  // 🔹 Autenticação
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    console.log("[DEBUG] Token ausente ou inválido:", authHeader);
    return res.status(401).json({ error: "Token ausente ou inválido." });
  }
  const token = authHeader.split(" ")[1];
  const user = await User.findOne({ token });
  if (!user) {
    console.log("[DEBUG] Usuário não encontrado para token:", token);
    return res.status(401).json({ error: "Usuário não autenticado." });
  }

  try {
    if (method === "GET") {
      const saquesFormatados = (user.saques || []).map(s => ({
        amount: s.valor ?? s.amount ?? null,
        pixKey: s.chave_pix ?? s.pixKey ?? null,
        keyType: s.tipo_chave ?? s.keyType ?? null,
        status: s.status ?? null,
        date: s.data ? (s.data instanceof Date ? s.data.toISOString() : new Date(s.data).toISOString()) : null,
        externalReference: s.externalReference || null,
        providerId: s.providerId || s.wooviId || s.openpixId || null,
      }));
      console.log("[DEBUG] Histórico de saques retornado:", saquesFormatados);
      return res.status(200).json(saquesFormatados);
    }

    // ===== POST =====
    // Normaliza body (compatível com body já parseado ou string)
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) { /* keep as-is */ }
    }

    const { amount, payment_method, payment_data } = body || {};
    console.log("[DEBUG] Dados recebidos para saque:", { amount, payment_method, payment_data });

    // Validações básicas
    if (!amount || (typeof amount !== "number" && typeof amount !== "string")) {
      console.log("[DEBUG] Valor de saque inválido:", amount);
      return res.status(400).json({ error: "Valor de saque inválido (mínimo R$0,01)." });
    }
    const amountNum = Number(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      console.log("[DEBUG] Valor de saque inválido após parse:", amountNum);
      return res.status(400).json({ error: "Valor de saque inválido." });
    }

    if (!payment_method || !payment_data?.pix_key || !payment_data?.pix_key_type) {
      console.log("[DEBUG] Dados de pagamento incompletos:", payment_data);
      return res.status(400).json({ error: "Dados de pagamento incompletos." });
    }

    // Verifica saldo (assumindo user.saldo em reais)
    if ((user.saldo ?? 0) < amountNum) {
      console.log("[DEBUG] Saldo insuficiente:", { saldo: user.saldo, amount: amountNum });
      return res.status(400).json({ error: "Saldo insuficiente." });
    }

    // Permitir apenas CPF por enquanto (ajuste se quiser permitir outros)
    const allowedTypes = ["CPF"];
    const keyType = (payment_data.pix_key_type || "").toUpperCase();
    if (!allowedTypes.includes(keyType)) {
      console.log("[DEBUG] Tipo de chave PIX inválido:", keyType);
      return res.status(400).json({ error: "Tipo de chave PIX inválido." });
    }

    // Formata chave
    let pixKey = String(payment_data.pix_key || "");
    if (keyType === "CPF" || keyType === "CNPJ") pixKey = pixKey.replace(/\D/g, "");
    console.log("[DEBUG] Chave PIX formatada:", pixKey);

    // Salva PIX do usuário se ainda não existir; se existir e diferente, bloqueia
    if (!user.pix_key) {
      user.pix_key = pixKey;
      user.pix_key_type = keyType;
      console.log("[DEBUG] Chave PIX salva no usuário:", { pixKey, keyType });
    } else if (user.pix_key !== pixKey) {
      console.log("[DEBUG] Chave PIX diferente da cadastrada:", { userPix: user.pix_key, novaPix: pixKey });
      return res.status(400).json({ error: "Chave PIX já cadastrada e não pode ser alterada." });
    }

    // Cria externalReference único
    const externalReference = `saque_${user._id}_${Date.now()}`;
    console.log("[DEBUG] externalReference gerada:", externalReference);

    // Monta objeto de saque e atualiza saldo & array (marca PENDING inicialmente)
    const novoSaque = {
      valor: amountNum,
      chave_pix: pixKey,
      tipo_chave: keyType,
      status: "PENDING",
      data: new Date(),
      providerId: null,
      externalReference,
      ownerName: user.name || user.nome || "Usuário",
    };

    // Deduz saldo e armazena saque
    user.saldo = (user.saldo ?? 0) - amountNum;
    user.saques = user.saques || [];
    user.saques.push(novoSaque);
    await user.save();
    console.log("[DEBUG] Usuário atualizado com novo saque. Saldo agora:", user.saldo);

    // ===== Comunica com o provedor OpenPix (create -> approve) =====
    const valueInCents = Math.round(amountNum * 100);

    if (!OPENPIX_API_KEY) {
      console.error("[ERROR] OPENPIX_API_KEY não configurada");
      // restaura saldo e marca erro
      const idxErr0 = user.saques.findIndex(s => s.externalReference === externalReference);
      if (idxErr0 >= 0) {
        user.saques[idxErr0].status = "FAILED";
        user.saques[idxErr0].error = { msg: "OPENPIX_API_KEY não configurada" };
        user.saldo += amountNum;
        await user.save();
      }
      return res.status(500).json({ error: "Configuração do provedor ausente." });
    }

    const createHeaders = {
      "Content-Type": "application/json",
      "Authorization": OPENPIX_API_KEY,
      "Idempotency-Key": externalReference
    };

    const createPayload = {
      value: valueInCents,
      destinationAlias: pixKey,
      destinationAliasType: keyType,
      correlationID: externalReference,
      comment: `Saque para ${user._id}`
    };

    console.log("[DEBUG] Payload createPayment enviado ao OpenPix:", createPayload);

    // Faz create payment
    let createRes;
    try {
      createRes = await fetch(`${OPENPIX_API_URL}/api/v1/payment`, {
        method: "POST",
        headers: createHeaders,
        body: JSON.stringify(createPayload)
      });
    } catch (err) {
      console.error("[ERROR] Falha na requisição createPayment:", err);
      // marca erro no saque e restaura saldo
      const idxErr = user.saques.findIndex(s => s.externalReference === externalReference);
      if (idxErr >= 0) {
        user.saques[idxErr].status = "FAILED";
        user.saques[idxErr].error = { msg: "Falha na requisição createPayment", detail: err.message };
        user.saldo += amountNum; // restaura saldo
        await user.save();
      }
      return res.status(500).json({ error: "Erro ao comunicar com o provedor de pagamentos." });
    }

    const createText = await createRes.text();
    let createData;
    try { createData = JSON.parse(createText); } catch (err) {
      console.error("[ERROR] Resposta createPayment não-JSON:", createText);
      // restaura saldo e marca erro
      const idx = user.saques.findIndex(s => s.externalReference === externalReference);
      if (idx >= 0) {
        user.saques[idx].status = "FAILED";
        user.saques[idx].error = { msg: "Resposta createPayment inválida", raw: createText };
        user.saldo += amountNum;
        await user.save();
      }
      return res.status(createRes.status || 500).json({ error: createText });
    }

    console.log("[DEBUG] Resposta createPayment:", createData, "Status HTTP:", createRes.status);

    if (!createRes.ok) {
      console.error("[DEBUG] Erro createPayment:", createData);
      // marca erro no saque e restaura saldo
      const idxErr = user.saques.findIndex(s => s.externalReference === externalReference);
      if (idxErr >= 0) {
        user.saques[idxErr].status = "FAILED";
        user.saques[idxErr].error = createData;
        user.saldo += amountNum;
        await user.save();
      }

      if (createRes.status === 403) {
        return res.status(403).json({ error: createData.error || createData.message || "Recurso não habilitado." });
      }

      return res.status(400).json({ error: createData.message || createData.error || "Erro ao criar pagamento no provedor." });
    }

    // Extrai possíveis identificadores úteis
    const paymentId = createData.id || createData.paymentId || createData.payment_id || createData.transaction?.id || null;
    const returnedCorrelation = createData.correlationID || createData.correlationId || createData.correlation || null;

    console.log("[DEBUG] paymentId extraído:", paymentId, "correlation retornada:", returnedCorrelation);

    // Atualiza o saque com providerId/correlation, mantendo status PENDING
    const createdIndex = user.saques.findIndex(s => s.externalReference === externalReference);
    if (createdIndex >= 0) {
      if (paymentId) user.saques[createdIndex].providerId = paymentId;
      if (!user.saques[createdIndex].externalReference) user.saques[createdIndex].externalReference = externalReference;
      user.saques[createdIndex].status = "PENDING";
      await user.save();
    }

    // Decide identificador para aprovação
    const toApproveIdentifier = paymentId || returnedCorrelation || externalReference;

    if (!toApproveIdentifier) {
      console.warn("[WARN] createPayment não retornou identificador usável — saque permanece PENDING.");
      return res.status(200).json({
        message: "Saque criado, aguardando aprovação manual (identificador não retornado).",
        create: createData
      });
    }

    // ===== Approve =====
    const approveHeaders = {
      "Content-Type": "application/json",
      "Authorization": OPENPIX_API_KEY,
      "Idempotency-Key": `approve_${toApproveIdentifier}`
    };

    const approvePayload = paymentId ? { paymentId } : { correlationID: toApproveIdentifier };
    console.log("[DEBUG] Enviando approvePayment:", approvePayload);

    let approveRes;
    try {
      approveRes = await fetch(`${OPENPIX_API_URL}/api/v1/payment/approve`, {
        method: "POST",
        headers: approveHeaders,
        body: JSON.stringify(approvePayload)
      });
    } catch (err) {
      console.error("[ERROR] Falha na requisição approvePayment:", err);
      if (createdIndex >= 0) {
        user.saques[createdIndex].status = "PENDING_APPROVAL";
        user.saques[createdIndex].error = { msg: "Falha na requisição de aprovação", detail: err.message };
        await user.save();
      }
      return res.status(500).json({ error: "Erro ao aprovar pagamento (comunicação com provedor)." });
    }

    const approveText = await approveRes.text();
    let approveData;
    try { approveData = JSON.parse(approveText); } catch (err) {
      console.error("[ERROR] Resposta approvePayment não-JSON:", approveText);
      if (createdIndex >= 0) {
        user.saques[createdIndex].status = "PENDING_APPROVAL";
        user.saques[createdIndex].error = { msg: "Resposta de aprovação inválida", raw: approveText };
        await user.save();
      }
      return res.status(approveRes.status || 500).json({ error: approveText });
    }

    console.log("[DEBUG] Resposta approvePayment:", approveData, "Status HTTP:", approveRes.status);

    if (!approveRes.ok) {
      console.error("[DEBUG] Erro approvePayment:", approveData);
      if (approveRes.status === 403) {
        if (createdIndex >= 0) {
          user.saques[createdIndex].status = "PENDING_APPROVAL";
          user.saques[createdIndex].error = approveData;
          await user.save();
        }
        return res.status(403).json({ error: approveData.error || approveData.message || "Aprovação negada." });
      }

      if (createdIndex >= 0) {
        user.saques[createdIndex].status = "PENDING_APPROVAL";
        user.saques[createdIndex].error = approveData;
        await user.save();
      }
      return res.status(400).json({ error: approveData.message || approveData.error || "Erro ao aprovar pagamento." });
    }

    // Se approve ok -> atualiza status conforme retorno
    const approveStatus = approveData.status || approveData.transaction?.status || "COMPLETED";
    if (createdIndex >= 0) {
      user.saques[createdIndex].status = (approveStatus === "COMPLETED" || approveStatus === "EXECUTED") ? "COMPLETED" : approveStatus;
      user.saques[createdIndex].providerId = user.saques[createdIndex].providerId || paymentId || approveData.id || null;
      await user.save();
    }

    // ===== Processar comissão de afiliado (5%) se saque COMPLETED =====
    try {
      const COMMISSION_RATE = 0.05;
      const isCompleted = approveStatus === "COMPLETED" || approveStatus === "EXECUTED";
      if (isCompleted) {
        // Recarrega user para garantir dados atualizados (opcional)
        const saqueRecord = (user.saques || []).find(s => s.externalReference === externalReference || s.providerId === (paymentId || null));
        const saqueValor = saqueRecord ? (saqueRecord.valor ?? amountNum) : amountNum;

        console.log("[DEBUG] Saque finalizado para comissão. Valor:", saqueValor, "externalReference:", externalReference);

        // Verifica se usuário foi indicado
        if (user.indicado_por) {
          // Evita pagar duas vezes: verificar se já existe ActionHistory para esse externalReference + tipo comissao
          const existente = await ActionHistory.findOne({ id_action: externalReference, tipo: "comissao" });
          if (existente) {
            console.log("[DEBUG] Comissão já registrada para esse saque (ignorar).", externalReference);
          } else {
            // verifica se o usuário que sacou está ativo (dentro do período ativo_ate)
            const agora = new Date();
            if (user.ativo_ate && new Date(user.ativo_ate) > agora) {
              // encontra afiliado (quem indicou)
              const afiliado = await User.findOne({ codigo_afiliado: user.indicado_por });
              if (afiliado) {
                const comissaoValor = Number((saqueValor * COMMISSION_RATE).toFixed(2)); // em reais, 2 decimais
                console.log("[DEBUG] Criando comissão para afiliado:", afiliado._id.toString(), "valor:", comissaoValor);

// cria registro de comissão no ActionHistory (com url_dir preenchido)
const acaoComissao = new ActionHistory({
  user: afiliado._id,
  token: afiliado.token || null,
  nome_usuario: afiliado.nome || afiliado.email || null,
  id_action: externalReference,                     // usado para evitar duplicidade
  id_pedido: `comissao_${externalReference}`,        // identificador próprio
  id_conta: user._id.toString(),                    // conta/usuário que gerou o saque
  unique_id: null,
  // Preenchendo url_dir com referência ao saque - evita erro de validação
  url_dir: `/saques/${externalReference}`,          
  acao_validada: "valida",
  valor_confirmacao: comissaoValor,
  quantidade_pontos: 0,
  tipo_acao: "comissao",
  rede_social: "Sistema",
  tipo: "comissao",
  afiliado: afiliado.codigo_afiliado,
  valor: comissaoValor,
  data: new Date(),
});
await acaoComissao.save();

                // Atualiza saldo do afiliado e histórico
                afiliado.saldo = (afiliado.saldo ?? 0) + comissaoValor;
                afiliado.historico_acoes = afiliado.historico_acoes || [];
                afiliado.historico_acoes.push(acaoComissao._id);
                await afiliado.save();

                console.log("[DEBUG] Comissão registrada e saldo do afiliado atualizado:", { afiliadoId: afiliado._id, novoSaldo: afiliado.saldo });
              } else {
                console.log("[DEBUG] Afiliado não encontrado para codigo:", user.indicado_por);
              }
            } else {
              console.log("[DEBUG] Usuário que sacou não está ativo ou ativo_ate expirou, sem comissão.", { indicado_por: user.indicado_por, ativo_ate: user.ativo_ate });
            }
          }
        } else {
          console.log("[DEBUG] Usuário não foi indicado (sem comissão).");
        }
      } else {
        console.log("[DEBUG] Saque não finalizado (status:", approveStatus, ") — sem comissão.");
      }
    } catch (errCom) {
      console.error("[ERROR] Falha ao processar comissão de afiliado:", errCom);
      // Não reverte o saque — apenas loga o erro
    }

    return res.status(200).json({
      message: "Saque processado (create → approve).",
      create: createData,
      approve: approveData
    });

  } catch (error) {
    console.error("💥 Erro em /withdraw:", error);
    return res.status(500).json({ error: "Erro ao processar saque." });
  }
}    

// Rota: /api/tiktok/get_user (GET)
if (url.startsWith("/api/tiktok/get_user") && method === "GET") {
  await connectDB();
  let { token, nome_usuario } = req.query;

  // Normaliza nome de usuário
  if (!token || !nome_usuario) {
    return res.status(400).json({ error: "Os parâmetros 'token' e 'nome_usuario' são obrigatórios." });
  }

  nome_usuario = nome_usuario.trim().toLowerCase();

  function generateFakeTikTokId() {
    const prefix = "74";
    const randomDigits = Array.from({ length: 17 }, () => Math.floor(Math.random() * 10)).join("");
    return prefix + randomDigits;
  }

  try {
    const usuario = await User.findOne({ token });
    if (!usuario) {
      return res.status(403).json({ error: "Acesso negado. Token inválido." });
    }

    // Verifica se a conta TikTok já está vinculada a outro usuário
    const contaJaRegistrada = await User.findOne({
      "contas.nomeConta": nome_usuario,
      token: { $ne: token }
    });

    if (contaJaRegistrada) {
      return res.status(200).json({
        status: 'fail',
        message: 'Essa conta TikTok já está vinculada a outro usuário.'
      });
    }

    // Consulta API externa
    const bindTkUrl = `http://api.ganharnoinsta.com/bind_tk.php?token=944c736c-6408-465d-9129-0b2f11ce0971&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nome_usuario}`;
    const bindResponse = await axios.get(bindTkUrl);
    const bindData = bindResponse.data;

    if (bindData.error === "TOKEN_INCORRETO") {
      return res.status(403).json({ error: "Token incorreto ao acessar API externa." });
    }

    const contaIndex = usuario.contas.findIndex(c => c.nomeConta === nome_usuario);

    // Caso o usuário não seja encontrado na API externa
    if (bindData.status === "fail" && bindData.message === "WRONG_USER") {
      let fakeId;

      if (contaIndex !== -1) {
        // Já existe, apenas atualiza
        fakeId = usuario.contas[contaIndex].id_fake || generateFakeTikTokId();
        usuario.contas[contaIndex].id_tiktok = null;
        usuario.contas[contaIndex].id_fake = fakeId;
        usuario.contas[contaIndex].status = "Pendente";
      } else {
        // Nova conta, adiciona
        fakeId = generateFakeTikTokId();
        usuario.contas.push({
          nomeConta: nome_usuario,
          id_tiktok: null,
          id_fake: fakeId,
          status: "Pendente"
        });
      }

      await usuario.save();
      return res.status(200).json({
        status: "success",
        id_tiktok: fakeId
      });
    }

    // Conta válida com ID retornado
    const returnedId = bindData.id_tiktok || generateFakeTikTokId();
    const isFake = !bindData.id_tiktok;

    if (contaIndex !== -1) {
      usuario.contas[contaIndex].id_tiktok = isFake ? null : returnedId;
      usuario.contas[contaIndex].id_fake = isFake ? returnedId : null;
      usuario.contas[contaIndex].status = "ativa";
    } else {
      usuario.contas.push({
        nomeConta: nome_usuario,
        id_tiktok: isFake ? null : returnedId,
        id_fake: isFake ? returnedId : null,
        status: "ativa"
      });
    }

    await usuario.save();
    return res.status(200).json({
      status: "success",
      id_tiktok: returnedId
    });

  } catch (error) {
    console.error("Erro ao processar requisição:", error.response?.data || error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}

// Rota: /api/get_action (GET)
if (url.startsWith("/api/tiktok/get_action") && method === "GET") {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

const { id_tiktok, token, tipo } = req.query;

let tipoAcao = "seguir";
if (tipo === "2") tipoAcao = "curtir";
else if (tipo === "3") tipoAcao = { $in: ["seguir", "curtir"] };


  if (!id_tiktok || !token) {
    return res.status(400).json({ error: "Parâmetros 'id_tiktok' e 'token' são obrigatórios" });
  }

  try {
    await connectDB();

    console.log("[GET_ACTION] Iniciando busca de ação para:", id_tiktok);

    // 🔐 Validação do token
    const usuario = await User.findOne({ token });
    if (!usuario) {
      console.log("[GET_ACTION] Token inválido:", token);
      return res.status(401).json({ error: "Token inválido" });
    }

    console.log("[GET_ACTION] Token válido para usuário:", usuario._id);

    // 🔍 Buscar pedidos locais válidos
const pedidos = await Pedido.find({
  rede: "tiktok",
  tipo: tipoAcao,
  status: { $ne: "concluida" },
  $expr: { $lt: ["$quantidadeExecutada", "$quantidade"] }
}).sort({ dataCriacao: -1 });

    console.log(`[GET_ACTION] ${pedidos.length} pedidos locais encontrados`);

    for (const pedido of pedidos) {
      const id_action = pedido._id;

const jaFez = await ActionHistory.findOne({
  id_pedido: pedido._id,
  id_conta: id_tiktok,
  acao_validada: { $in: ['pendente', 'validada'] }
});

      if (jaFez) {
        console.log(`[GET_ACTION] Ação local já feita para pedido ${id_action}, pulando`);
        continue;
      }

const feitas = await ActionHistory.countDocuments({
  id_pedido: pedido._id,
  acao_validada: { $in: ['pendente', 'validada'] }
});

      if (feitas >= pedido.quantidade) {
        console.log(`[GET_ACTION] Limite atingido para pedido ${id_action}, pulando`);
        continue;
      }

      console.log("[GET_ACTION] Ação local encontrada:", pedido.link);

      const nomeUsuario = pedido.link.includes("@")
        ? pedido.link.split("@")[1].split(/[/?#]/)[0]
        : pedido.nome;

let valorFinal;
if (pedido.tipo === "curtir") {
  valorFinal = "0.001";
} else {
  valorFinal = "0.006";
}

const tipoAcaoRetorno = pedido.tipo === "curtir" ? "curtir" : "seguir";

return res.status(200).json({
  status: "sucess",
  id_tiktok,
  id_action: pedido._id.toString(),
  url: pedido.link,
  nome_usuario: nomeUsuario,
  tipo_acao: tipoAcaoRetorno,
  valor: valorFinal
});

    }

console.log("[GET_ACTION] Nenhuma ação local válida encontrada, buscando na API externa...");

console.log("[GET_ACTION] Nenhuma ação local válida encontrada.");

if (tipo === "2") {
  console.log("[GET_ACTION] Tipo 2 (curtidas locais) e nenhuma ação local encontrada. Ignorando API externa.");
  return res.status(200).json({ status: "fail", message: "nenhuma ação disponível no momento" });
}

// 🔁 Se não for tipo 2, continua buscando na API externa
console.log("[GET_ACTION] Nenhuma ação local válida encontrada, buscando na API externa...");

const apiURL = `https://api.ganharnoinsta.com/get_action.php?token=944c736c-6408-465d-9129-0b2f11ce0971&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&id_conta=${id_tiktok}&is_tiktok=1&tipo=1`;
const response = await axios.get(apiURL);
const data = response.data;

if (data.status === "CONTA_INEXISTENTE") {
  console.log("[GET_ACTION] Conta inexistente na API externa:", id_tiktok);
  return res.status(200).json({ status: "fail", id_tiktok, message: "Nenhuma ação disponível no momento." });
}

if (data.status === "ENCONTRADA") {
  const pontos = parseFloat(data.quantidade_pontos);

  // ❌ REMOVIDO o trecho que ignorava ações com 4 pontos

  // ✅ Agora processa qualquer valor de pontos normalmente
  const valorBruto = pontos / 1000;
  const valorDescontado = (valorBruto > 0.004)
    ? valorBruto - 0.001
    : valorBruto;
  const valorFinal = Math.min(Math.max(valorDescontado, 0.004), 0.006).toFixed(3);

  const idPedidoOriginal = String(data.id_pedido);

  const temp = await TemporaryAction.create({
    id_tiktok,
    url_dir: data.url_dir,
    nome_usuario: data.nome_usuario,
    tipo_acao: "seguir",
    valor: valorFinal,
    id_action: idPedidoOriginal,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000)
  });

  console.log("[GET_ACTION] TemporaryAction salva:", temp);
  console.log("[GET_ACTION] Ação externa registrada em TemporaryAction");

  return res.status(200).json({
    status: "sucess",
    id_tiktok,
    id_action: idPedidoOriginal,
    url: data.url_dir,
    nome_usuario: data.nome_usuario,
    tipo_acao: data.tipo_acao,
    valor: valorFinal
  });
}

    console.log("[GET_ACTION] Nenhuma ação encontrada local ou externa.");
    return res.status(200).json({ status: "fail", message: "nenhuma ação disponível no momento" });

  } catch (err) {
    console.error("[GET_ACTION] Erro ao buscar ação:", err);
    return res.status(500).json({ error: "Erro interno ao buscar ação" });
  }
  
};

// Rota: /api/confirm_action (POST)
if (url.startsWith("/api/tiktok/confirm_action") && method === "POST") {
  await connectDB();

  const { token, id_action, id_tiktok } = req.body;
  if (!token || !id_action || !id_tiktok) {
    return res.status(400).json({ error: "Parâmetros obrigatórios ausentes." });
  }

  try {
    const usuario = await User.findOne({ token });
    if (!usuario) {
      return res.status(403).json({ error: "Acesso negado. Token inválido." });
    }

    console.log("🧩 id_action recebido:", id_action);

    function normalizarTipo(tipo) {
      const mapa = {
        seguir: "seguir",
        seguiram: "seguir",
        Seguir: "seguir",
        curtidas: "curtir",
        curtir: "curtir",
        Curtir: "curtir",
      };
      return mapa[tipo?.toLowerCase?.()] || "seguir";
    }

    // 🔍 Verificar se a ação é local (existe no Pedido)
    const pedidoLocal = await Pedido.findById(id_action);

    let valorFinal = 0;
    let tipo_acao = "Seguir";
    let url_dir = "";

    if (pedidoLocal) {
      console.log("📦 Confirmando ação local:", id_action);

      tipo_acao = normalizarTipo(pedidoLocal.tipo_acao || pedidoLocal.tipo);

      if (tipo_acao === "curtir") {
        valorFinal = 0.001;
      } else if (tipo_acao === "seguir") {
        valorFinal = 0.006;
      }

      url_dir = pedidoLocal.link;
    } else {
      // 🔍 AÇÃO EXTERNA – Buscar no TemporaryAction
      const tempAction = await TemporaryAction.findOne({ id_tiktok, id_action });

      if (!tempAction) {
        console.log("❌ TemporaryAction não encontrada para ação externa:", id_tiktok, id_action);
        return res.status(404).json({ error: "Ação temporária não encontrada" });
      }

      // 🔐 Confirmar ação via API externa
      const payload = {
        token: "944c736c-6408-465d-9129-0b2f11ce0971",
        sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
        id_conta: id_tiktok,
        id_pedido: id_action,
        is_tiktok: "1",
      };

      let confirmData = {};
      try {
        const confirmResponse = await axios.post(
          "https://api.ganharnoinsta.com/confirm_action.php",
          payload,
          { timeout: 5000 }
        );
        confirmData = confirmResponse.data || {};
        console.log("📬 Resposta da API confirmar ação:", confirmData);
      } catch (err) {
        console.error("❌ Erro ao confirmar ação (externa):", err.response?.data || err.message);
        return res.status(502).json({ error: "Falha na confirmação externa." });
      }

      const valorOriginal = parseFloat(confirmData.valor || tempAction?.valor || 0);
      const valorDescontado = valorOriginal > 0.003 ? valorOriginal - 0.001 : valorOriginal;
      valorFinal = parseFloat(Math.min(Math.max(valorDescontado, 0.003), 0.006).toFixed(3));
      tipo_acao = normalizarTipo(confirmData.tipo_acao || tempAction?.tipo_acao);
      url_dir = tempAction?.url_dir || "";
    }

    // 💾 Salva o valor real (sem arredondar para exibição)
    const newAction = new ActionHistory({
      token,
      nome_usuario: usuario.contas.find(
        (c) => c.id_tiktok === id_tiktok || c.id_fake === id_tiktok
      )?.nomeConta,
      tipo_acao,
      tipo: tipo_acao,
      quantidade_pontos: valorFinal,
      url_dir,
      id_conta: id_tiktok,
      id_action,
      id_pedido: id_action,
      user: usuario._id,
      acao_validada: "pendente",
      valor_confirmacao: valorFinal,
      data: new Date(),
    });

    const saved = await newAction.save();
    usuario.historico_acoes.push(saved._id);
    await usuario.save();

    // ✅ Exibição: apenas 0.003 vira 0.004 no retorno
    const valorExibicao = valorFinal === 0.003 ? 0.004 : valorFinal;

    return res.status(200).json({
      status: "sucess",
      message: "ação confirmada com sucesso",
      valor: valorExibicao,
    });
  } catch (error) {
    console.error("💥 Erro ao processar requisição:", error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}

// Rota: /api/pular_acao
if (url.startsWith("/api/pular_acao") && method === "POST") {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const {
    token,
    id_pedido,
    id_conta,
    nome_usuario,
    url_dir,
    quantidade_pontos,
    tipo_acao,
    tipo
  } = req.body;

  if (!token || !id_pedido || !id_conta || !nome_usuario || !url_dir || !quantidade_pontos || !tipo_acao || !tipo) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }

  try {
    await connectDB();

    const user = await User.findOne({ token });
    if (!user) {
      return res.status(401).json({ error: 'Token inválido' });
    }

const existente = await ActionHistory.findOne({
  id_pedido,
  id_conta,
  acao_validada: 'pulada',
});

if (existente) {
  return res.status(200).json({ status: 'JA_PULADA' });
}

const novaAcao = new ActionHistory({
  user: user._id,
  token,
  nome_usuario,
  id_action: crypto.randomUUID(),
  id_pedido,
  id_conta,
  url_dir,
  quantidade_pontos,
  tipo_acao,
  tipo,
  acao_validada: 'pulada',
  rede_social: 'TikTok',
  createdAt: new Date()
});

    await novaAcao.save();

    return res.status(200).json({ status: 'PULADA_REGISTRADA' });
  } catch (error) {
    console.error('Erro ao registrar ação pulada:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
};

// Rota: /api/proxy_bind_tk
if (url.startsWith("/api/proxy_bind_tk") && method === "GET") {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { nome_usuario } = req.query;
  if (!nome_usuario) {
    return res.status(400).json({ error: 'Parâmetro nome_usuario é obrigatório' });
  }

  try {
    const url = `http://api.ganharnoinsta.com/bind_tk.php?token=944c736c-6408-465d-9129-0b2f11ce0971&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${encodeURIComponent(nome_usuario)}`;

    const response = await fetch(url);
    const data = await response.text(); // texto cru vindo da API externa
    const txt = String(data || "").trim();

    // Normaliza: se o texto contém NOT_FOUND devolvemos status fail/message
    if (txt.toUpperCase().includes("NOT_FOUND")) {
      return res.status(200).json({ status: 'fail', message: 'NOT_FOUND', resposta: txt });
    }

    // outros casos de erro detectáveis pela string (opcional)
    if (/ERROR|FAIL|INVALID/i.test(txt)) {
      return res.status(200).json({ status: 'fail', message: txt, resposta: txt });
    }

    // sucesso (ou resposta que não indica erro)
    return res.status(200).json({ status: 'SUCESSO', resposta: txt });
  } catch (error) {
    console.error('Erro ao consultar API externa:', error);
    return res.status(500).json({ error: 'Erro ao consultar API externa' });
  }
};

// 🔹 Rota: /api/afiliados
if (url.startsWith("/api/afiliados") && method === "POST") {
  // não destrua `token` do body com o mesmo nome do header
  const { token: bodyToken } = req.body || {};

  try {
    await connectDB();

    const authHeader = req.headers.authorization;
    if (!authHeader && !bodyToken) {
      return res.status(401).json({ error: "Acesso negado, token não encontrado." });
    }

    // prefira o token do header, fallback para bodyToken
    const tokenFromHeader = authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : authHeader; // caso mandem só o token sem "Bearer "

    const effectiveToken = tokenFromHeader || bodyToken;
    console.log("🔹 Token usado para autenticação:", !!effectiveToken); // booleano para não vazar token

    if (!effectiveToken) return res.status(401).json({ error: "Token inválido." });

    const user = await User.findOne({ token: effectiveToken });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado ou token inválido." });

    // Código do afiliado
    const codigo_afiliado = user.codigo_afiliado || user._id.toString();

    // 🔗 Busca todos os indicados por este afiliado
    const indicados = await User.find({ indicado_por: codigo_afiliado });

    const total_indicados = indicados.length;

    // 🔹 Filtra apenas os ativos dentro de 30 dias
    const agora = new Date();
    const indicados_ativos = indicados.filter(u => u.status === "ativo" && u.ativo_ate && new Date(u.ativo_ate) > agora).length;

    // 💰 Soma das comissões
    const comissoes = await ActionHistory.aggregate([
      { $match: { tipo: "comissao", afiliado: codigo_afiliado } },
      { $group: { _id: null, total: { $sum: "$valor" } } }
    ]);
    const total_comissoes = comissoes.length > 0 ? comissoes[0].total : 0;

    console.log("[DEBUG] Dados de afiliado:", { codigo_afiliado, total_indicados, indicados_ativos, total_comissoes });

    return res.status(200).json({ total_comissoes, total_indicados, indicados_ativos, codigo_afiliado });

  } catch (error) {
    console.error("Erro ao carregar dados de afiliados:", error);
    return res.status(500).json({ error: "Erro interno ao buscar dados de afiliados." });
  }
}

// Rota: /api/registrar_acao_pendente
if (url.startsWith("/api/registrar_acao_pendente")) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Token não fornecido." });
  }

  const token = authHeader.replace("Bearer ", "");
  const usuario = await User.findOne({ token });
  if (!usuario) {
    return res.status(401).json({ error: "Token inválido." });
  }

  const {
    id_conta,
    id_pedido,
    nome_usuario,
    url_dir,
    tipo_acao,
    quantidade_pontos,
    unique_id
  } = req.body;

  if (!id_pedido || !id_conta || !nome_usuario || !tipo_acao || quantidade_pontos == null) {
    return res.status(400).json({ error: "Campos obrigatórios ausentes." });
  }

 try {
  const idPedidoStr = id_pedido.toString();
  const tipoAcaoFinal = url_dir.includes("/video/") ? "curtir" : "seguir";

  const pontos = parseFloat(quantidade_pontos);
  const valorBruto = pontos / 1000;
  const valorDescontado = (valorBruto > 0.003) ? valorBruto - 0.001 : valorBruto;
  const valorFinalCalculado = Math.min(Math.max(valorDescontado, 0.003), 0.006).toFixed(3);
  const valorConfirmacaoFinal = (tipoAcaoFinal === "curtir") ? "0.001" : valorFinalCalculado;

  const novaAcao = new ActionHistory({
    user: usuario._id,
    token: usuario.token,
    nome_usuario,
    id_pedido: idPedidoStr,
    id_action: idPedidoStr,
    id_conta,
    url_dir,
    unique_id,
    tipo_acao,
    quantidade_pontos,
    tipo: tipoAcaoFinal,
    rede_social: "TikTok",
    valor_confirmacao: valorConfirmacaoFinal,
    acao_validada: "pendente",
    data: new Date()
  });

  // 🔁 Salva com controle de limite por usuário
  await salvarAcaoComLimitePorUsuario(novaAcao);

  return res.status(200).json({ status: "pendente", message: "Ação registrada com sucesso." });

} catch (error) {
  console.error("Erro ao registrar ação pendente:", error);
  return res.status(500).json({ error: "Erro ao registrar ação." });
}
}

  if (!url.startsWith("/api/test/gerenciar_acoes")) {
    console.log("❌ Rota não corresponde:", url);
    return res.status(404).json({ error: "Rota não encontrada." });
  }

  console.log("👉 [ROTA] /api/test/gerenciar_acoes acessada.");
  console.log("🔹 Método:", method);

  try {
    console.log("🟧 Conectando ao banco...");
    await connectDB();
    console.log("🟩 Banco conectado.");

    // ========================
    // 1️⃣ Autenticação (verifica token apenas para permitir acesso)
    // ========================
    console.log("🔍 Verificando header Authorization...");
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      console.log("❌ Token não enviado.");
      return res.status(401).json({ error: "Acesso negado, token não encontrado." });
    }

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : authHeader;

    console.log("🔍 Token recebido:", token);

    const user = await User.findOne({ token });
    console.log("🔍 Usuário encontrado:", user ? user._id : "NÃO ENCONTRADO");

    if (!user) {
      console.log("❌ Usuário não encontrado, token inválido.");
      return res.status(404).json({ error: "Usuário não encontrado ou token inválido." });
    }

    // ========================
    // 2️⃣ Somente POST
    // ========================
    console.log("🔸 Verificando método POST...");
    if (method !== "POST") {
      console.log("❌ Método inválido:", method);
      return res.status(405).json({ error: "Use POST." });
    }

    console.log("📥 Body recebido:", req.body);
    const { modo, periodo, status, tipo, pagina = 1 } = req.body;

    // Helper: calcula data inicial com base no 'periodo' que o frontend envia
    function calcularInicioPorPeriodo(p) {
      if (!p || p === "all" || p === "todos") return null;
      const agora = Date.now();

      switch (String(p)) {
        case "24h":
        case "24horas":
          return new Date(agora - 24 * 60 * 60 * 1000);
        case "7d":
        case "7dias":
          return new Date(agora - 7 * 24 * 60 * 60 * 1000);
        case "30d":
        case "30dias":
          return new Date(agora - 30 * 24 * 60 * 60 * 1000);
        case "90d":
        case "90dias":
          return new Date(agora - 90 * 24 * 60 * 60 * 1000);
        case "365d":
        case "365dias":
          return new Date(agora - 365 * 24 * 60 * 60 * 1000);
        case "hoje":
          const inicioHoje = new Date();
          inicioHoje.setHours(0, 0, 0, 0);
          return inicioHoje;
        default:
          return null;
      }
    }

    // =====================================================================================
    // 3️⃣ MODO RESUMO (agrega TODAS as ações do sistema)
    // =====================================================================================
// === INÍCIO: bloco modo === "resumo" ajustado para respeitar filtros ===
if (modo === "resumo") {
    console.log("📌 MODO RESUMO ativado (com filtros).");
    // monta filtros a partir do que veio no body
    const filtrosResum = {};

    // STATUS
    if (status && status !== "todos" && status !== "all") {
        const mapStatus = { pending: "pendente", valid: "valida", invalid: "invalida" };
        filtrosResum.acao_validada = mapStatus[status] || status;
        console.log("🔍 Resumo -> filtro status:", filtrosResum.acao_validada);
    }

    // TIPO
    if (tipo && tipo !== "todos" && tipo !== "all") {
        filtrosResum.tipo = tipo;
        console.log("🔍 Resumo -> filtro tipo:", filtrosResum.tipo);
    }

    // PERÍODO (usa a mesma função/calculo do modo lista)
    function calcularInicioPorPeriodo(p) {
        if (!p || p === "all" || p === "todos") return null;
        const agora = Date.now();
        switch (String(p)) {
            case "24h": return new Date(agora - 24 * 60 * 60 * 1000);
            case "7d": return new Date(agora - 7 * 24 * 60 * 60 * 1000);
            case "30d": return new Date(agora - 30 * 24 * 60 * 60 * 1000);
            case "90d": return new Date(agora - 90 * 24 * 60 * 60 * 1000);
            case "365d": return new Date(agora - 365 * 24 * 60 * 60 * 1000);
            case "hoje":
                const inicioHoje = new Date(); inicioHoje.setHours(0,0,0,0); return inicioHoje;
            default: return null;
        }
    }

    if (periodo && periodo !== "todos" && periodo !== "all") {
        const inicio = calcularInicioPorPeriodo(periodo);
        if (inicio) {
            // sua collection tem createdAt, então filtramos por createdAt
            filtrosResum.createdAt = { $gte: inicio };
            console.log("🔍 Resumo -> filtro período desde:", inicio.toISOString());
        } else {
            console.log("🔍 Resumo -> período não mapeado:", periodo);
        }
    }

    // Agora usamos filtrosResum para contar (cada contagem pode adicionar/alterar acao_validada)
    console.log("🔍 Resumo -> filtro final:", filtrosResum);

    console.log("🔄 Contando ações pendentes (com filtros)...");
    console.time("⏱ pendentes");
    const pendentes = await ActionHistory.countDocuments({
        ...filtrosResum,
        acao_validada: "pendente"
    });
    console.timeEnd("⏱ pendentes");
    console.log("📌 Pendentes (filtrados):", pendentes);

    console.log("🔄 Contando ações válidas (com filtros)...");
    console.time("⏱ validas");
    const validas = await ActionHistory.countDocuments({
        ...filtrosResum,
        acao_validada: "valida"
    });
    console.timeEnd("⏱ validas");
    console.log("📌 Válidas (filtradas):", validas);

    console.log("🔄 Contando ações inválidas (com filtros)...");
    console.time("⏱ invalidas");
    const invalidas = await ActionHistory.countDocuments({
        ...filtrosResum,
        acao_validada: "invalida"
    });
    console.timeEnd("⏱ invalidas");
    console.log("📌 Inválidas (filtradas):", invalidas);

    // Para o total somamos apenas as válidas, mas respeitando outros filtros (tipo/periodo)
    console.log("🔄 Calculando total ganho (válidas + filtros)...");
    console.time("⏱ total");
    const ganhosMatch = { ...filtrosResum, acao_validada: "valida" };
    const totalGanhoArr = await ActionHistory.aggregate([
        { $match: ganhosMatch },
        { $group: { _id: null, soma: { $sum: "$valor" } } }
    ]);
    console.timeEnd("⏱ total");
    console.log("📌 Aggregation total ganho (filtrado):", totalGanhoArr);

    const total = totalGanhoArr[0]?.soma || 0;
    console.log("💰 Total ganho calculado (filtrado):", total);

    return res.status(200).json({
        pendentes,
        validas,
        invalidas,
        total
    });
}
// === FIM: bloco modo === "resumo" ajustado ===

    // =====================================================================================
    // 4️⃣ MODO LISTA (filtros, periodo, status, tipo, paginação) — lista TODAS as ações do sistema
    // =====================================================================================

    console.log("📌 MODO LISTA ativado.");

    const filtros = {}; // lista ações de todo mundo
    console.log("🔍 Filtros iniciais:", filtros);

    // STATUS (aceita 'all' ou 'todos' para sem filtro)
    if (status && status !== "todos" && status !== "all") {
      const mapStatus = {
        pending: "pendente",
        valid: "valida",
        invalid: "invalida"
      };
      filtros.acao_validada = mapStatus[status] || status;
      console.log("🔍 Filtro por status:", filtros.acao_validada);
    }

    // TIPO (aceita 'all' para sem filtro)
    if (tipo && tipo !== "todos" && tipo !== "all") {
      filtros.tipo = tipo;
      console.log("🔍 Filtro por tipo:", tipo);
    }

    // PERÍODO (aceita valores do frontend: 24h, 7d, 30d, 90d, 365d, all)
    if (periodo && periodo !== "todos" && periodo !== "all") {
      const inicio = calcularInicioPorPeriodo(periodo);
      if (inicio) {
        // sua collection usa createdAt (conforme exemplos), então filtramos por createdAt
        filtros.createdAt = { $gte: inicio };
        console.log("🔍 Filtro por período:", filtros.createdAt);
      } else {
        console.log("🔍 Período informado não mapeado para intervalo:", periodo);
      }
    }

    // PAGINAÇÃO
    const porPagina = 20;
    const page = Number(pagina) > 0 ? Number(pagina) : 1;
    const skip = (page - 1) * porPagina;

    console.log("🔢 Paginando: página", page, "skip", skip);

    console.log("🔄 Contando total de documentos com filtro...");
    const total = await ActionHistory.countDocuments(filtros);
    const totalPaginas = Math.ceil(total / porPagina);
    console.log("📌 Total registros:", total, "| Total páginas:", totalPaginas);

    console.log("🔄 Buscando ações...");
    const acoes = await ActionHistory.find(filtros)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(porPagina)
      .lean();

    console.log("📌 Ações encontradas:", acoes.length);

    // FORMATAÇÃO
    const resultado = acoes.map(a => ({
      data: a.createdAt,
      tipo: a.tipo,
      descricao: a.descricao || "",
      status:
        a.acao_validada === "valida"
          ? "valid"
          : a.acao_validada === "invalida"
          ? "invalid"
          : "pending",
      valor: Number(a.valor || 0)
    }));

    console.log("📦 Enviando lista com", resultado.length, "registros.");

    return res.status(200).json({
      pagina_atual: page,
      total_paginas: totalPaginas,
      acoes: resultado
    });

  } catch (error) {
    console.error("❌ ERRO GERAL EM /api/test/gerenciar_acoes:");
    console.error("📄 Mensagem:", error.message);
    console.error("📄 Stack:", error.stack);

    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}



// === Endpoint handler (substitui o bloco antigo) ===
if (url.startsWith('/api/test/ranking_diario') && method === 'POST') {
  try {
    await connectDB();
    await ensureUniqueDataIndexOnce();

    const rankingQuery = query || {};
    const { token: bodyToken } = req.body || {};

    // autenticação (prefere header Authorization Bearer)
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
    const effectiveToken = tokenFromHeader || bodyToken;
    if (!effectiveToken) return res.status(401).json({ error: 'Token inválido.' });

    const user = await User.findOne({ token: effectiveToken });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado ou token inválido.' });

    // tempo/dia — use helper consistente
    const agora = Date.now();
    const CACHE_MS = 1 * 60 * 1000; // 1 minuto
    const hoje = hojeBRString(new Date());

    // Carrega dailyFixedRanking do DB se necessário
    if (!dailyFixedRanking || diaTop3 !== hoje) {
      try {
        const saved = await DailyRanking.findOne({ data: hoje }).lean().catch(() => null);
        if (saved && Array.isArray(saved.ranking) && saved.ranking.length) {
          dailyFixedRanking = saved.ranking.map((entry) => ({
            username: entry.username ?? entry.nome ?? 'Usuário',
            token: entry.token ?? null,
            real_total: Number(entry.real_total ?? 0),
            is_current_user: !!entry.is_current_user,
            userId: entry.userId ? String(entry.userId) : null
          }));

          if (saved.startAt) {
            horaInicioRanking = new Date(saved.startAt).getTime();
          } else if (saved.criadoEm) {
            horaInicioRanking = new Date(saved.criadoEm).getTime();
          } else {
            horaInicioRanking = startAtForBRDay(new Date()).getTime();
          }

          top3FixosHoje = dailyFixedRanking.slice(0, 3).map((u) => ({ ...u }));
          diaTop3 = hoje;
          zeroedAtMidnight = false;
          console.log('📥 Loaded dailyFixedRanking from DB for', hoje, dailyFixedRanking.map((d) => d.username));
        } else {
          // sem documento: semear e criar atômicamente
          let pool = fillerNames.slice();
          shuffleArray(pool);

          const seededFull = pool.map((nm, idx) => ({
            username: nm || 'Usuário',
            token: null,
            real_total: Number(baselineValores[idx] ?? 1),
            userId: null,
            source: 'fixed'
          }));

          const toSave = seededFull.slice(0, Math.min(30, seededFull.length));
          const startAtDate = startAtForBRDay(new Date());
          const expiresAtDate = midnightExpiresBR(new Date());

          const createdOrExisting = await createOrGetDailyRanking(hoje, {
            ranking: toSave,
            startAt: startAtDate,
            expiresAt: expiresAtDate,
            criadoEm: new Date()
          });

          const finalRanking = (createdOrExisting && Array.isArray(createdOrExisting.ranking)) ? createdOrExisting.ranking : toSave;
          dailyFixedRanking = finalRanking.slice(0, 10).map((x, i) => ({
            username: x.username,
            token: x.token || null,
            real_total: Number(x.real_total || baselineValores[i] || 1),
            is_current_user: x.token === effectiveToken,
            userId: x.userId || null,
            source: x.source || 'fixed'
          }));

          horaInicioRanking = (new Date(createdOrExisting.startAt || startAtDate)).getTime();
          top3FixosHoje = dailyFixedRanking.slice(0, 3).map(u => ({ ...u }));
          diaTop3 = hoje;
          zeroedAtMidnight = false;

          console.log('⚙️ Sem documento DailyRanking para hoje — semei com fillerNames:', dailyFixedRanking.map(d => d.username));
        }
      } catch (e) {
        console.error('Erro ao carregar/semear DailyRanking do DB:', e);
      }
    }

    // Reset por env/URL (mantive sua lógica)
    const resetPorEnv = process.env.RESET_RANKING === 'true';
    const resetPorURL = rankingQuery.reset === 'true';
    if (resetPorEnv || resetPorURL) {
      await DailyEarning.deleteMany({});
      await User.updateMany({}, { $set: { saldo: 0 } });

      let topFromEarnings = (typeof fetchTopFromDailyEarning === 'function') ? await fetchTopFromDailyEarning(10) : await safeFetchTopFromDailyEarning(10);

      if (topFromEarnings.length < 10) {
        const need = 10 - topFromEarnings.length;
        const usedNorms = new Set(topFromEarnings.map(p => norm(p.username) || ''));
        const extras = [];
        const startIndex = topFromEarnings.length;
        for (const nm of fillerNames) {
          if (extras.length >= need) break;
          const n = norm(nm);
          if (!usedNorms.has(n)) {
            const idxForBaseline = startIndex + extras.length;
            extras.push({ username: nm, token: null, real_total: Number(baselineValores[idxForBaseline] ?? 0), userId: null, source: 'fixed' });
            usedNorms.add(n);
          }
        }
        topFromEarnings = topFromEarnings.concat(extras);
      }

      if (topFromEarnings.length < 10) {
        const need = 10 - topFromEarnings.length;
        const usedNorms = new Set(topFromEarnings.map(p => norm(p.username) || ''));
        const extras = [];
        for (const nm of fillerNames) {
          if (extras.length >= need) break;
          const n = norm(nm);
          if (!usedNorms.has(n)) {
            extras.push({ username: nm, token: null, real_total: 0, userId: null, source: 'filler' });
            usedNorms.add(n);
          }
        }
        topFromEarnings = topFromEarnings.concat(extras);
      }

      shuffleArray(topFromEarnings);

      dailyFixedRanking = topFromEarnings.slice(0, 10).map((c, idx) => ({ username: c.username, token: c.token || null, real_total: Number((c.real_total && c.real_total > 0) ? c.real_total : baselineValores[idx] || 0), is_current_user: c.token === effectiveToken, userId: c.userId || null }));
      shuffleArray(dailyFixedRanking);

      try {
        const startAtDate2 = startAtForBRDay(new Date());
        const expiresAtDate2 = midnightExpiresBR(new Date());
        const createdOrExisting = await createOrGetDailyRanking(hoje, { ranking: dailyFixedRanking, startAt: startAtDate2, expiresAt: expiresAtDate2, criadoEm: new Date() });

        const finalRanking = (createdOrExisting && Array.isArray(createdOrExisting.ranking)) ? createdOrExisting.ranking : dailyFixedRanking;
        dailyFixedRanking = finalRanking.slice(0, 10).map((x, i) => ({ username: x.username, token: x.token || null, real_total: Number(x.real_total || baselineValores[i] || 0), is_current_user: x.token === effectiveToken, userId: x.userId || null }));

        horaInicioRanking = (new Date(createdOrExisting.startAt || startAtDate2)).getTime();
        top3FixosHoje = dailyFixedRanking.slice(0, 3).map(u => ({ ...u }));
        diaTop3 = hoje;
        zeroedAtMidnight = true;

        console.log('🔥 Reset manual — dailyFixedRanking criado (somente dailyearnings/dailyrankings):', dailyFixedRanking.map(d => d.username));

        if (resetPorURL) {
          const placeholder = dailyFixedRanking.map((d, i) => ({ position: i + 1, username: d.username, total_balance: formatarValorRanking(d.real_total), is_current_user: !!d.is_current_user }));
          return res.status(200).json({ success: true, message: 'Ranking e saldos zerados (reset manual).', ranking: placeholder });
        }
      } catch (e) {
        console.error('Erro ao salvar DailyRanking no DB (reset manual):', e);
      }
    }

    // Reset automático à meia-noite: detecta mudança de dia
    if (diaTop3 && diaTop3 !== hoje) {
      console.log('🕛 Novo dia detectado — resetando ranking diário automaticamente...');
      await DailyEarning.deleteMany({});
      await User.updateMany({}, { $set: { saldo: 0 } });

      let topFromEarnings = (typeof fetchTopFromDailyEarning === 'function') ? await fetchTopFromDailyEarning(10) : await safeFetchTopFromDailyEarning(10);

      if (topFromEarnings.length < 10) {
        const need = 10 - topFromEarnings.length;
        const usedNorms = new Set(topFromEarnings.map(p => norm(p.username) || ''));
        const extras = [];
        const startIndex = topFromEarnings.length;
        for (const nm of fillerNames) {
          if (extras.length >= need) break;
          const n = norm(nm);
          if (!usedNorms.has(n)) {
            const idxForBaseline = startIndex + extras.length;
            extras.push({ username: nm, token: null, real_total: Number(baselineValores[idxForBaseline] ?? 0), userId: null, source: 'fixed' });
            usedNorms.add(n);
          }
        }
        topFromEarnings = topFromEarnings.concat(extras);
      }

      if (topFromEarnings.length < 10) {
        const need = 10 - topFromEarnings.length;
        const usedNorms = new Set(topFromEarnings.map(p => norm(p.username) || ''));
        const extras = [];
        for (const nm of fillerNames) {
          if (extras.length >= need) break;
          const n = norm(nm);
          if (!usedNorms.has(n)) {
            extras.push({ username: nm, token: null, real_total: 0, userId: null, source: 'filler' });
            usedNorms.add(n);
          }
        }
        topFromEarnings = topFromEarnings.concat(extras);
      }

      shuffleArray(topFromEarnings);
      dailyFixedRanking = topFromEarnings.slice(0, 10).map((c, idx) => ({ username: c.username, token: c.token || null, real_total: Number((c.real_total && c.real_total > 0) ? c.real_total : baselineValores[idx] || 0), is_current_user: c.token === effectiveToken, userId: c.userId || null }));
      shuffleArray(dailyFixedRanking);

      try {
        const startAtDate2 = startAtForBRDay(new Date());
        const expiresAtDate2 = midnightExpiresBR(new Date());
        const createdOrExisting = await createOrGetDailyRanking(hoje, { ranking: dailyFixedRanking, startAt: startAtDate2, expiresAt: expiresAtDate2, criadoEm: new Date() });

        const finalRanking = (createdOrExisting && Array.isArray(createdOrExisting.ranking)) ? createdOrExisting.ranking : dailyFixedRanking;
        dailyFixedRanking = finalRanking.slice(0, 10).map((x, i) => ({ username: x.username, token: x.token || null, real_total: Number(x.real_total || baselineValores[i] || 0), is_current_user: x.token === effectiveToken, userId: x.userId || null }));

        horaInicioRanking = (new Date(createdOrExisting.startAt || startAtDate2)).getTime();
        top3FixosHoje = dailyFixedRanking.slice(0, 3).map(u => ({ ...u }));
        diaTop3 = hoje;
        zeroedAtMidnight = true;

        console.log('💾 dailyFixedRanking salvo no DB (midnight reset) — somente dailyearnings/dailyrankings');
      } catch (e) {
        console.error('Erro ao salvar DailyRanking no DB (midnight):', e);
      }

      const placeholder = dailyFixedRanking.map((d, i) => ({ position: i + 1, username: d.username, total_balance: formatarValorRanking(d.real_total), is_current_user: !!d.is_current_user }));
      console.log('✅ Reset automático meia-noite — dailyFixedRanking:', dailyFixedRanking.map(d => d.username));
      return res.status(200).json({ ranking: placeholder });
    }

    // Cache check
    if (ultimoRanking && agora - ultimaAtualizacao < CACHE_MS && diaTop3 === hoje) {
      return res.status(200).json({ ranking: ultimoRanking });
    }

    // Montagem do ranking base (prioriza dailyFixedRanking e incorpora DailyEarning)
    let baseRankingRaw = null;

    if (dailyFixedRanking && diaTop3 === hoje) {
      const baseFromFixed = dailyFixedRanking.map((u, idx) => ({ username: (u.username || 'Usuário').toString(), token: u.token || null, real_total: Number(u.real_total || 0), is_current_user: !!u.is_current_user, source: 'fixed', userId: u.userId || null, fixedPosition: idx }));

      // --- Busca ganhos reais do DB (DailyEarning)
      let ganhosPorUsuario = [];
      try {
        ganhosPorUsuario = await DailyEarning.aggregate([
          { $group: { _id: '$userId', totalGanhos: { $sum: '$valor' } } },
          { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'usuario' } },
          { $unwind: { path: '$usuario', preserveNullAndEmptyArrays: true } },
          { $project: { userId: '$_id', username: { $ifNull: ['$usuario.nome', 'Usuário'] }, token: { $ifNull: ['$usuario.token', null] }, real_total: '$totalGanhos' } }
        ]).exec();
      } catch (e) {
        console.error('Erro ao agregar DailyEarning durante fusão (prioridade):', e);
        ganhosPorUsuario = [];
      }

      const mapa = new Map();
      const ganhosPorPosicao = [12,11,10,9,8,7,6,5,4,3,2,1];
      const perMinuteGain = ganhosPorPosicao.map(g => g / 10);
      const agoraMs = Date.now();
      const baseHoraInicio = horaInicioRanking || agoraMs;
      const intervalosDecorridos = Math.floor((agoraMs - baseHoraInicio) / (60 * 1000));
      console.log('📊 intervalosDecorridos (min):', intervalosDecorridos, 'horaInicioRanking:', new Date(baseHoraInicio).toISOString());

      baseFromFixed.forEach((u, idx) => {
        const keyToken = u.token ? `T:${String(u.token)}` : null;
        const keyId = u.userId ? `I:${String(u.userId)}` : null;
        const keyUname = `U:${norm(u.username)}`;
        const baseObj = { username: String(u.username || 'Usuário'), token: u.token || null, real_total: Number(u.real_total || 0), source: 'fixed', fixedPosition: idx, is_current_user: !!u.is_current_user, userId: u.userId || null };
        if (keyToken) mapa.set(keyToken, { ...baseObj });
        if (keyId) mapa.set(keyId, { ...baseObj });
        mapa.set(keyUname, { ...baseObj });
      });

      function findExistingKeyFor(item) {
        if (item.token) {
          const k = `T:${String(item.token)}`;
          if (mapa.has(k)) return k;
        }
        if (item.userId) {
          const k = `I:${String(item.userId)}`;
          if (mapa.has(k)) return k;
        }
        const unameKey = `U:${norm(item.username)}`;
        if (mapa.has(unameKey)) return unameKey;
        for (const existingKey of mapa.keys()) {
          const ex = mapa.get(existingKey);
          if (ex && norm(ex.username) === norm(item.username)) return existingKey;
        }
        return null;
      }

      ganhosPorUsuario.forEach(g => {
        const item = { username: String(g.username || 'Usuário'), token: g.token || null, real_total: Number(g.real_total || 0), source: 'earnings', userId: g.userId ? String(g.userId) : null, is_current_user: (g.token && g.token === effectiveToken) || false };
        const existingKey = findExistingKeyFor(item);
        if (existingKey) {
          const ex = mapa.get(existingKey);
          if (ex && ex.source === 'fixed') {
            const pos = (typeof ex.fixedPosition === 'number') ? ex.fixedPosition : null;
            const incrementoPorMinuto = pos !== null ? (perMinuteGain[pos] || 0) : 0;
            const projectedFixed = Number(ex.real_total || 0) + incrementoPorMinuto * intervalosDecorridos;
            if (Number(item.real_total) >= projectedFixed) {
              mapa.set(existingKey, { username: item.username || ex.username, token: item.token || ex.token, real_total: Number(item.real_total), source: 'earnings', userId: item.userId || ex.userId || null, is_current_user: ex.is_current_user || item.is_current_user });
            } else {
              ex.earnings_total = Number(item.real_total);
              mapa.set(existingKey, ex);
            }
          } else {
            mapa.set(existingKey, { username: item.username, token: item.token || (ex && ex.token) || null, real_total: Number(item.real_total), source: item.source, userId: item.userId || (ex && ex.userId) || null, is_current_user: (ex && ex.is_current_user) || item.is_current_user });
          }
        } else {
          const key = item.token ? `T:${String(item.token)}` : `U:${norm(item.username)}`;
          mapa.set(key, { ...item });
        }
      });

      const listaComProjetado = Array.from(new Map(Array.from(mapa.values()).map(e => {
        const definitiveKey = e.token ? `T:${e.token}` : (e.userId ? `I:${e.userId}` : `U:${norm(e.username)}`);
        return [definitiveKey, e];
      })).values()).map(entry => {
        const e = { ...entry };
        if (e.source === 'fixed') {
          const pos = (typeof e.fixedPosition === 'number') ? e.fixedPosition : null;
          const incrementoPorMinuto = pos !== null ? (perMinuteGain[pos] || 0) : 0;
          const projected = Number(e.real_total || 0) + incrementoPorMinuto * intervalosDecorridos;
          e.current_total = Number(projected);
        } else {
          e.current_total = Number(e.real_total || 0);
        }
        return e;
      });

      if (listaComProjetado.length < 10) {
        const need = 10 - listaComProjetado.length;
        const used = new Set(listaComProjetado.map(x => norm(x.username)));
        for (const nm of fillerNames) {
          if (listaComProjetado.length >= 10) break;
          if (!used.has(norm(nm))) {
            const idxForBaseline = listaComProjetado.length;
            listaComProjetado.push({ username: nm, token: null, real_total: Number(baselineValores[idxForBaseline] ?? 0), current_total: Number(baselineValores[idxForBaseline] ?? 0), source: 'fixed', is_current_user: false, userId: null });
            used.add(norm(nm));
          }
        }
        if (listaComProjetado.length < 10) {
          const need2 = 10 - listaComProjetado.length;
          const used2 = new Set(listaComProjetado.map(x => norm(x.username)));
          for (const nm of fillerNames) {
            if (listaComProjetado.length >= 10) break;
            if (!used2.has(norm(nm))) {
              listaComProjetado.push({ username: nm, token: null, real_total: 0, current_total: 0, source: 'filler', is_current_user: false, userId: null });
              used2.add(norm(nm));
            }
          }
        }
      }

      listaComProjetado.sort((a,b) => Number(b.current_total || b.real_total || 0) - Number(a.current_total || a.real_total || 0));
      const top10 = listaComProjetado.slice(0, 10);
      function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
      baseRankingRaw = top10.map(item => ({ username: item.username, token: item.token || null, real_total: round2(Number(item.current_total || item.real_total || 0)), source: item.source || 'unknown', is_current_user: !!item.is_current_user }));
    } else {
      // fallback original: gera a partir do DB (sem fixed)
      const ganhosPorUsuario = await DailyEarning.aggregate([
        { $group: { _id: '$userId', totalGanhos: { $sum: '$valor' } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'usuario' } },
        { $unwind: { path: '$usuario', preserveNullAndEmptyArrays: true } },
        { $project: { userId: '$_id', username: { $ifNull: ['$usuario.nome', 'Usuário'] }, total_balance: '$totalGanhos', token: { $ifNull: ['$usuario.token', null] } } },
        { $sort: { total_balance: -1 } },
        { $limit: 10 }
      ]).exec();

      baseRankingRaw = (ganhosPorUsuario || []).filter(item => (item.total_balance ?? 0) > 0).map(item => ({ username: item.username || 'Usuário', token: item.token || null, real_total: Number(item.total_balance || 0), is_current_user: item.token === effectiveToken, source: 'earnings' }));

      if (baseRankingRaw.length < 10) {
        const saved = await DailyRanking.findOne({}).lean().catch(() => null);
        if (saved && Array.isArray(saved.ranking)) {
          const extrasShuffled = shuffleArray((saved.ranking || []).slice());
          for (const r of extrasShuffled) {
            if (baseRankingRaw.length >= 10) break;
            const uname = norm(r.username || r.nome || 'Usuário');
            if (!baseRankingRaw.some(x => norm(x.username) === uname)) {
              baseRankingRaw.push({ username: r.username || r.nome || 'Usuário', token: r.token || null, real_total: Number(r.real_total || 0), is_current_user: false, source: 'fixed_from_saved' });
            }
          }
        }
      }

      baseRankingRaw.sort((a,b) => Number(b.real_total) - Number(a.real_total));
    }

    // Limita a 10 posições
    const finalRankingRaw = (baseRankingRaw || []).slice(0, 10);
    const formatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const finalRanking = finalRankingRaw.map((item, idx) => ({ position: idx + 1, username: item.username, total_balance: formatter.format(Number(item.real_total || 0)), real_total: Number(item.real_total || 0), is_current_user: !!(item.token && item.token === effectiveToken), source: item.source || 'unknown' }));

    // Atualiza cache
    ultimoRanking = finalRanking;
    ultimaAtualizacao = agora;
    zeroedAtMidnight = false;

    console.log('🔢 final top3 (numeros reais):', finalRanking.slice(0,3).map(r => `${r.username}=${r.real_total}`));
    return res.status(200).json({ ranking: finalRanking });

  } catch (error) {
    console.error('❌ Erro ao buscar ranking (handler completo):', error);
    return res.status(500).json({ error: 'Erro interno ao buscar ranking' });
  }
}

// FIM DA ROTA /api/test/ranking_diario
