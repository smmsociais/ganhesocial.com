import axios from "axios";
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import connectDB from "./db.js";
import nodemailer from 'nodemailer';
import { sendRecoveryEmail } from "./mailer.js";
import crypto from "crypto";
import { User, ActionHistory, DailyEarning, Pedido, TemporaryAction } from "./schema.js";

export default async function handler(req, res) {
    const { method, url } = req;

async function salvarAcaoComLimitePorUsuario(novaAcao) {
  const LIMITE = 2000;

  const total = await ActionHistory.countDocuments({ user: novaAcao.user });

  if (total >= LIMITE) {
    const excess = total - LIMITE + 1; // +1 para abrir espaço
    await ActionHistory.find({ user: novaAcao.user })
      .sort({ createdAt: 1 }) // mais antigos primeiro
      .limit(excess)
      .deleteMany();
  }

  await novaAcao.save();
}

const formatarValorRanking = (valor) => {
  if (valor <= 1) return "1+";
  if (valor > 1 && valor < 5) return "1+";
  if (valor < 10) return "5+";
  if (valor < 50) return "10+";
  if (valor < 100) return "50+";
  if (valor < 500) return "100+";
  if (valor < 1000) return "500+";
  const base = Math.floor(valor / 1000) * 1000;
  return `${base}+`;
};

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
if (url.startsWith("/api/contas")) {
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

    // 🔍 Verifica se a conta já existe neste próprio usuário
    const contaExistente = user.contas.find(c => c.nomeConta === nomeConta);

    if (contaExistente) {
        if (contaExistente.status === "ativa") {
            return res.status(400).json({ error: "Esta conta já está ativa." });
        }

        // ✅ Reativar a conta
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
        "contas.nomeConta": nomeConta
    });

    if (contaDeOutroUsuario) {
        return res.status(400).json({ error: "Já existe uma conta com este nome de usuário." });
    }

    // ➕ Adiciona nova conta
    user.contas.push({ nomeConta, id_conta, id_tiktok, status: "ativa" });
    await user.save();

    return res.status(201).json({ message: "Conta adicionada com sucesso!", nomeConta });
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



// ... dentro do handler
if (url.startsWith("/api/signup") && method === "POST") {
  await connectDB();

  const {email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ error: "Todos os campos são obrigatórios." });
  }

  // (mantém sua verificação reCAPTCHA aqui)
  // ...

  try {
    // verifica email
    const emailExiste = await User.findOne({ email });
    if (emailExiste) {
      return res.status(400).json({ error: "E-mail já cadastrado." });
    }

    const token = crypto.randomBytes(32).toString("hex");

    // Função para gerar codigo_afiliado (curto)
    const gerarCodigo = () => uuidv4().split("-")[0]; // ex: 'a1b2c3d4'

    // tenta salvar com retries em caso de colisão de índice unico
    const maxRetries = 5;
    let attempt = 0;
    let savedUser = null;

    while (attempt < maxRetries && !savedUser) {
      const codigo_afiliado = gerarCodigo();

      const novoUsuario = new User({
        email,
        senha,
        token,
        codigo_afiliado,
        // não precisa setar indicado_por aqui — virá do query ?ref no frontend no registro
      });

      try {
        savedUser = await novoUsuario.save();
        // sucesso — sai do loop
      } catch (err) {
        // Se for erro de duplicata no codigo_afiliado, gera outro e tenta de novo
        if (err && err.code === 11000 && err.keyPattern && err.keyPattern.codigo_afiliado) {
          console.warn(`[SIGNUP] Colisão codigo_afiliado (tentativa ${attempt+1}). Gerando novo código.`);
          attempt++;
          continue;
        }
        // outro erro — propaga
        throw err;
      }
    }

    if (!savedUser) {
      return res.status(500).json({ error: "Não foi possível gerar um código de afiliado único. Tente novamente." });
    }

    // sucesso: retorne token e codigo
    return res.status(201).json({
      message: "Usuário registrado com sucesso!",
      token: savedUser.token,
      codigo_afiliado: savedUser.codigo_afiliado,
      id: savedUser._id
    });

  } catch (error) {
    console.error("Erro ao cadastrar usuário:", error);
    // tratamento específico para duplicate key em email
    if (error && error.code === 11000 && error.keyPattern && error.keyPattern.email) {
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

  // 👇 Se for 4 pontos, ignorar e tentar buscar local novamente
  if (pontos === 4) {
    console.log("[GET_ACTION] Ignorando ação externa com 4 pontos. Tentando buscar novamente ações locais.");

    // Refazer busca de ações locais (mesma lógica anterior, duplicada aqui)
    const pedidosRetry = await Pedido.find({
  rede: "tiktok",
  tipo: tipoAcao,
  status: { $ne: "concluida" },
  $expr: { $lt: ["$quantidadeExecutada", "$quantidade"] }
}).sort({ dataCriacao: -1 });

    for (const pedido of pedidosRetry) {
      const id_action = pedido._id;

      const nomeUsuario = pedido.link.includes("@")
        ? pedido.link.split("@")[1].split(/[/?#]/)[0]
        : pedido.nome;

      const valorBruto = pedido.valor / 1000;
      const valorDescontado = (valorBruto > 0.004)
        ? valorBruto - 0.001
        : valorBruto;
      const valorFinal = Math.min(Math.max(valorDescontado, 0.004), 0.006).toFixed(3);

      return res.status(200).json({
        status: "sucess",
        id_tiktok,
        id_action: pedido._id.toString(),
        url: pedido.link,
        nome_usuario: nomeUsuario,
        tipo_acao: "seguir",
        valor: valorFinal
      });
    }

    // Se nem na segunda tentativa local encontrou, responde 204
    return res.status(200).json({ status: "fail", message: "nenhuma ação disponível no momento" });
  }

  // Caso pontos diferentes de 4, processa normalmente
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
    seguir: 'seguir',
    seguiram: 'seguir',
    'Seguir': 'seguir',
    curtidas: 'curtir',
    curtir: 'curtir',
    'Curtir': 'curtir',
  };
  return mapa[tipo?.toLowerCase?.()] || 'seguir';
}

    // 🔍 Verificar se a ação é local (existe no Pedido)
    const pedidoLocal = await Pedido.findById(id_action);

    let valorFinal = 0;
    let tipo_acao = 'Seguir';
    let url_dir = '';

if (pedidoLocal) {
  console.log("📦 Confirmando ação local:", id_action);

tipo_acao = normalizarTipo(pedidoLocal.tipo_acao || pedidoLocal.tipo);

if (tipo_acao === 'curtir') {
  valorFinal = 0.001;
} else if (tipo_acao === 'seguir') {
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
        is_tiktok: "1"
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
      const valorDescontado = valorOriginal > 0.004 ? valorOriginal - 0.001 : valorOriginal;
      valorFinal = parseFloat(Math.min(Math.max(valorDescontado, 0.004), 0.006).toFixed(3));
      tipo_acao = normalizarTipo(confirmData.tipo_acao || tempAction?.tipo_acao);
      url_dir = tempAction?.url_dir || '';
    }

const newAction = new ActionHistory({
  token,
  nome_usuario: usuario.contas.find(c => c.id_tiktok === id_tiktok || c.id_fake === id_tiktok)?.nomeConta,
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
  data: new Date()
});

    const saved = await newAction.save();
    usuario.historico_acoes.push(saved._id);
    await usuario.save();

    return res.status(200).json({
      status: 'sucess',
      message: 'ação confirmada com sucesso',
      valor: valorFinal
    });

  } catch (error) {
    console.error("💥 Erro ao processar requisição:", error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}

// Rota: /api/ranking
if (url.startsWith("/api/ranking") && method === "POST") {
 if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { authorization } = req.headers;
    const token = authorization?.split(" ")[1];

    if (!token || token !== process.env.API_SECRET) {
      return res.status(401).json({ error: "Não autorizado" });
    }

    await connectDB();

    const { user_token } = req.body;

    if (!user_token) {
      return res.status(400).json({ error: "Token do usuário não fornecido" });
    }

    const usuarioAtual = await User.findOne({ token: user_token });
    if (!usuarioAtual) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const ganhosPorUsuario = await DailyEarning.aggregate([
      {
        $group: {
          _id: "$userId",
          totalGanhos: { $sum: "$valor" }
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "usuario"
        }
      },
      { $unwind: "$usuario" },
      {
        $project: {
          _id: 0,
          username: { $ifNull: ["$usuario.nome", ""] },
          total_balance: "$totalGanhos",
          token: "$usuario.token"
        }
      }
    ]);

    // Aplica a formatação
const ranking = ganhosPorUsuario
  .filter(item => item.total_balance > 1) // 🔥 Remove usuários com valor ≤ 1
  .map(item => {
    const valorFormatado = formatarValorRanking(item.total_balance);

    return {
      username: item.username,
      total_balance: valorFormatado,
      is_current_user: item.token === user_token
    };
  });

    // Ordena do maior para o menor (reverter ordenação usando o valor numérico real)
    ranking.sort((a, b) => {
      const numA = parseInt(a.total_balance);
      const numB = parseInt(b.total_balance);
      return numB - numA;
    });

    return res.status(200).json({ ranking });

  } catch (error) {
    console.error("❌ Erro ao buscar ranking:", error);
    return res.status(500).json({ error: "Erro interno ao buscar ranking" });
  }
};

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
    const data = await response.text(); // A API externa parece retornar texto plano

    return res.status(200).json({ status: 'SUCESSO', resposta: data });

  } catch (error) {
    console.error('Erro ao consultar API externa:', error);
    return res.status(500).json({ error: 'Erro ao consultar API externa' });
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
    // aceita amount em reais (float) ou em centavos (inteiro)? assumimos reais (ex.: 10.50) -> convert below
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
      ownerName: user.name || "Usuário",
    };

    // Deduz saldo e armazena saque
    user.saldo = (user.saldo ?? 0) - amountNum;
    user.saques = user.saques || [];
    user.saques.push(novoSaque);
    await user.save();
    console.log("[DEBUG] Usuário atualizado com novo saque. Saldo agora:", user.saldo);

    // ===== Comunica com o provedor OpenPix (create -> approve) =====
    // Converte para centavos
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

    // A API do OpenPix geralmente aceita { correlationID } conforme seu exemplo
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

// 🔹 Rota: /api/afiliados
if (url.startsWith("/api/afiliados") && method === "POST") {
    const { user_token } = req.body;

    if (!user_token) {
        return res.status(400).json({ error: "Token do usuário é obrigatório." });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== "Bearer 4769") {
        console.log("[DEBUG] Falha na autorização:", authHeader);
        return res.status(401).json({ error: "Não autorizado." });
    }

    try {
        await connectDB();

        // 🔍 Busca o usuário principal
        const user = await User.findOne({ token: user_token });
        if (!user) {
            console.log("[DEBUG] Usuário não encontrado para token:", user_token);
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        // Código do afiliado
        const codigo_afiliado = user.codigo_afiliado || user._id.toString();

        // 🔗 Busca todos os indicados
        const indicados = await User.find({ indicado_por: codigo_afiliado });
        const total_indicados = indicados.length;
        const indicados_ativos = indicados.filter(u => u.status === "ativo").length;

        // 💰 Soma das comissões (supondo que estão salvas em alguma coleção relacionada)
        const comissoes = await ActionHistory.aggregate([
            { $match: { tipo: "comissao", afiliado: codigo_afiliado } },
            { $group: { _id: null, total: { $sum: "$valor" } } }
        ]);

        const total_comissoes = comissoes.length > 0 ? comissoes[0].total : 0;

        console.log("[DEBUG] Dados de afiliado:", {
            codigo_afiliado,
            total_indicados,
            indicados_ativos,
            total_comissoes
        });

        return res.status(200).json({
            total_comissoes,
            total_indicados,
            indicados_ativos,
            codigo_afiliado
        });

    } catch (error) {
        console.error("Erro ao carregar dados de afiliados:", error);
        return res.status(500).json({ error: "Erro interno ao buscar dados de afiliados." });
    }
}

    return res.status(404).json({ error: "Rota não encontrada." });
}
