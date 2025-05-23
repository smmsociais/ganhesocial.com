import axios from "axios";
import connectDB from "./db.js";
import mongoose from "mongoose";
import nodemailer from 'nodemailer';
import { sendRecoveryEmail } from "./mailer.js";
import crypto from "crypto";
import { User, ActionHistory, Pedido, TemporaryAction } from "./schema.js";

function getBrasiliaMidnightDate() {
    const now = new Date();
    const brasiliaMidnight = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    brasiliaMidnight.setUTCHours(3, 0, 0, 0);
    return brasiliaMidnight;
}

function formatarDataBrasilia(data) {
    const dataUTC = new Date(data.getTime() - 3 * 60 * 60 * 1000);
    const dia = String(dataUTC.getUTCDate()).padStart(2, "0");
    const mes = String(dataUTC.getUTCMonth() + 1).padStart(2, "0");
    const ano = dataUTC.getUTCFullYear();
    return `${dia}/${mes}/${ano}`;
}

export default async function handler(req, res) {
    const { method, url } = req;

    // Rota: /api/vincular_conta (POST)
    if (url.startsWith("/api/vincular_conta") && method === "POST") {
        const { nomeUsuario } = req.body;

        if (!nomeUsuario) {
            return res.status(400).json({ error: "Nome de usuário é obrigatório." });
        }

        const urlBind = `http://api.ganharnoinsta.com/bind_tk.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nomeUsuario}`;

        try {
            const { data } = await axios.get(urlBind);

            if (data.status === "success") {
                return res.status(200).json({ id_conta: data.id_conta });
            } else {
                return res.status(400).json({ error: "Erro ao vincular conta." });
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

        const urlAction = `https://api.ganharnoinsta.com/get_action.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&id_conta=${id_conta}&is_tiktok=1&tipo=1`;

        try {
            const { data } = await axios.get(urlAction);

            if (data.status === "ENCONTRADA") {
                return res.status(200).json({
                    ...data,
                    unique_id: data.unique_id || null
                });
            } else {
                return res.status(404).json({ error: "Nenhuma ação encontrada." });
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
            token: "afc012ec-a318-433d-b3c0-5bf07cd29430",
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

            if (user.contas.some(conta => conta.nomeConta === nomeConta)) {
                return res.status(400).json({ error: "Já existe uma conta com este nome de usuário." });
            }

            user.contas.push({ nomeConta, id_conta, id_tiktok });
            await user.save();

            return res.status(201).json({ message: "Conta adicionada com sucesso!", nomeConta });
        }

        if (method === "GET") {
            return res.json(user.contas);
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

            user.contas.splice(contaIndex, 1);
            await user.save();

            return res.status(200).json({ message: `Conta ${nomeConta} desativada com sucesso.` });
        }

        return res.status(405).json({ error: "Método não permitido." });

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

// Rota: /api/withdraw (GET ou POST)
if (url.startsWith("/api/withdraw")) {
  if (method !== "GET" && method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token ausente ou inválido." });
  }

  const token = authHeader.split(" ")[1];
  const user = await User.findOne({ token });

  if (!user) {
    return res.status(401).json({ error: "Usuário não autenticado." });
  }

  try {
    if (method === "GET") {
      const saquesFormatados = user.saques.map(saque => ({
        amount: saque.valor,
        pixKey: saque.chave_pix,
        keyType: saque.tipo_chave,
        status: saque.status,
        date: saque.data?.toISOString() || null
      }));
      return res.status(200).json(saquesFormatados);
    }

    if (method === "POST") {
      const { amount, payment_method, payment_data } = req.body;

      if (!amount || typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ error: "Valor de saque inválido." });
      }

      if (!payment_method || !payment_data?.pix_key || !payment_data?.pix_key_type) {
        return res.status(400).json({ error: "Dados de pagamento incompletos." });
      }

      if (user.saldo < amount) {
        return res.status(400).json({ error: "Saldo insuficiente para saque." });
      }

      if (!user.pix_key) {
        user.pix_key = payment_data.pix_key;
        user.pix_key_type = payment_data.pix_key_type;
      } else if (user.pix_key !== payment_data.pix_key) {
        return res.status(400).json({ error: "Chave PIX já cadastrada e não pode ser alterada." });
      }

      user.saldo -= amount;
      user.saques.push({
        valor: amount,
        chave_pix: user.pix_key,
        tipo_chave: user.pix_key_type,
        status: "pendente",
        data: new Date()
      });

      await user.save();
      return res.status(200).json({ message: "Saque solicitado com sucesso." });
    }
  } catch (error) {
    console.error("💥 Erro em /withdraw:", error);
    return res.status(500).json({ error: "Erro ao processar saque." });
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
      .find({ nome_usuario: nomeUsuarioParam })
      .sort({ data: -1 });
  
    const formattedData = historico.map(action => {
      let status;
      if (action.acao_validada === true) status = "Válida";
      else if (action.acao_validada === false) status = "Inválida";
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
      .find({ user: usuario._id })
      .sort({ data: -1 });

    const formattedData = historico.map(action => {
      let status;
      if (action.acao_validada === true) status = "Válida";
      else if (action.acao_validada === false) status = "Inválida";
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

// Rota: /api/get_historico (GET)
if (url.startsWith("/api/get_historico")) {
    if (method !== "GET") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    const { token } = req.query;
    if (!token) {
        return res.status(400).json({ error: "Token obrigatório." });
    }

    try {
        const usuario = await User.findOne({ token }).select("ganhosPorDia saldo");
        if (!usuario) {
            return res.status(403).json({ error: "Acesso negado." });
        }

        const ganhosMap = new Map();

        for (const ganho of usuario.ganhosPorDia || []) {
            const dataStr = formatarDataBrasilia(new Date(ganho.data));
            ganhosMap.set(dataStr, ganho.valor);
        }

        const historico = [];
        const hoje = getBrasiliaMidnightDate();

        for (let i = 0; i < 30; i++) {
            const data = new Date(hoje);
            data.setDate(data.getDate() - i);

            const dataFormatada = formatarDataBrasilia(data);
            const valor = ganhosMap.get(dataFormatada) || 0;

            historico.push({ data: dataFormatada, valor });
        }

        historico.reverse(); // Do mais antigo para o mais recente

        res.status(200).json({ historico });
    } catch (error) {
        console.error("Erro ao obter histórico de ganhos:", error);
        res.status(500).json({ error: "Erro ao buscar histórico de ganhos." });
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
            acao_validada: null
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
            console.time("⏱️ Tempo total de login");
            await connectDB();
            console.timeLog("⏱️ Tempo total de login", "✔️ Conectado ao MongoDB");
    
            const { email, senha } = req.body;
    
            if (!email || !senha) {
                return res.status(400).json({ error: "E-mail e senha são obrigatórios!" });
            }
    
            console.log("🔍 Buscando usuário no banco de dados...");
            const usuario = await User.findOne({ email });
            console.timeLog("⏱️ Tempo total de login", "✔️ Usuário buscado");
    
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
                console.timeLog("⏱️ Tempo total de login", "✔️ Token gerado e salvo");
    
                console.log("🟢 Novo token gerado e salvo.");
            } else {
                console.log("🟢 Token já existente mantido.");
            }
            console.timeEnd("⏱️ Tempo total de login");
    
            console.log("🔹 Token gerado para usuário:", token);
            return res.json({ message: "Login bem-sucedido!", token });
    
        } catch (error) {
            console.error("❌ Erro ao realizar login:", error);
            return res.status(500).json({ error: "Erro ao realizar login" });
        }
        
    };

// Rota: /api/signup
if (url.startsWith("/api/signup")) {
        if (req.method !== "POST") {
            return res.status(405).json({ error: "Método não permitido." });
        }
    
        await connectDB();
    
        const { email, senha } = req.body;
    
        if (!email || !senha) {
            return res.status(400).json({ error: "Todos os campos são obrigatórios." });
        }
    
        try {
    
            const emailExiste = await User.findOne({ email });
            if (emailExiste) {
                return res.status(400).json({ error: "E-mail já está cadastrado." });
            }
    
            // Gerar token único
            const token = crypto.randomBytes(32).toString("hex");
    
            const novoUsuario = new User({ email, senha, token });
            await novoUsuario.save();
    
            return res.status(201).json({ message: "Usuário registrado com sucesso!", token });
        } catch (error) {
            console.error("Erro ao cadastrar usuário:", error);
            return res.status(500).json({ error: "Erro interno ao registrar usuário. Tente novamente mais tarde." });
        }
    };

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
    
// Rota: /api/mailer
if (url.startsWith("/api/mailer")) {

      const transporter = nodemailer.createTransport({
        host: 'smtpout.secureserver.net',
        port: 465,
        secure: true, // Porta 465 exige SSL
        auth: {
          user: 'contato@ganhesocial.com',
          pass: 'reno4769!', // sua senha real
        },
      });
    
      const mailOptions = {
        from: '"GanheSocial" <contato@ganhesocial.com>',
        to: email,
        subject: 'Recuperação de Senha',
        html: `
          <p>Você solicitou a recuperação de senha.</p>
          <p>Clique no link abaixo para redefinir sua senha:</p>
          <p><a href="${link}">${link}</a></p>
          <p>Se você não solicitou essa recuperação, ignore este email.</p>
        `,
      };
    
      try {
        await transporter.sendMail(mailOptions);
        console.log(`Link de recuperação enviado para ${email}`);
      } catch (error) {
        console.error('Erro ao enviar email:', error);
        throw new Error('Erro ao enviar email de recuperação');
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
    quantidade_pontos
  } = req.body;

  if (!id_pedido || !id_conta || !nome_usuario || !tipo_acao || quantidade_pontos == null) {
    return res.status(400).json({ error: "Campos obrigatórios ausentes." });
  }

  try {
    const pontos = parseFloat(quantidade_pontos);
    const valorBruto = pontos / 1000;
    const valorDescontado = (valorBruto > 0.004)
      ? valorBruto - 0.001
      : valorBruto;
    const valorFinal = Math.min(Math.max(valorDescontado, 0.004), 0.006).toFixed(3);

    const novaAcao = new ActionHistory({
      user: usuario._id,
      token: usuario.token,
      nome_usuario,
      id_pedido,
      id_conta,
      url_dir,
      tipo_acao,
      quantidade_pontos,
      tipo: tipo_acao || "Seguir",
      rede_social: "TikTok",
      valor_confirmacao: valorFinal,
      acao_validada: null,
      data: new Date()
    });

    await novaAcao.save();

    return res.status(200).json({ status: "pendente", message: "Ação registrada com sucesso." });

  } catch (error) {
    console.error("Erro ao registrar ação pendente:", error);
    return res.status(500).json({ error: "Erro ao registrar ação." });
  }
}

// Rota: /api/get_user (GET)
if (url.startsWith("/api/get_user") && method === "GET") {
    await connectDB();

    const { token, nome_usuario } = req.query;
    if (!token || !nome_usuario) {
        return res.status(400).json({ error: "Os parâmetros 'token' e 'nome_usuario' são obrigatórios." });
    }

    try {
        const usuario = await User.findOne({ token });

        if (!usuario) {
            return res.status(403).json({ error: "Acesso negado. Token inválido." });
        }

        const bindTkUrl = `http://api.ganharnoinsta.com/bind_tk.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nome_usuario}`;
        const bindResponse = await axios.get(bindTkUrl);
        const bindData = bindResponse.data;

        if (bindData.error === "TOKEN_INCORRETO") {
            return res.status(403).json({ error: "Token incorreto ao acessar API externa." });
        }

        const contaIndex = usuario.contas.findIndex(c => c.nomeConta === nome_usuario);

        if (bindData.status === "fail" && bindData.message === "WRONG_USER") {
            const novaConta = { nomeConta: nome_usuario, id_tiktok: null, status: "Pendente" };

            if (contaIndex !== -1) {
                usuario.contas[contaIndex] = { ...usuario.contas[contaIndex], ...novaConta };
            } else {
                usuario.contas.push(novaConta);
            }

            await usuario.save();
            return res.status(200).json({ status: "success" });
        }

        const novaConta = {
            nomeConta: nome_usuario,
            id_tiktok: bindData.id_tiktok || null,
            status: bindData.id_tiktok ? "Vinculada" : "Pendente"
        };

        if (contaIndex !== -1) {
            usuario.contas[contaIndex] = { ...usuario.contas[contaIndex], ...novaConta };
        } else {
            usuario.contas.push(novaConta);
        }

        await usuario.save();

        return res.status(200).json({
            status: "success",
            ...(bindData.id_tiktok && { id_tiktok: bindData.id_tiktok })
        });

    } catch (error) {
        console.error("Erro ao processar requisição:", error.response?.data || error.message);
        return res.status(500).json({ error: "Erro interno ao processar requisição." });
    }
}

// Rota: /api/get_action (GET)
if (url.startsWith("/api/get_action") && method === "GET") {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { id_tiktok, token } = req.query;

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
  tipo: "seguidores", // <- corrigido
  status: { $ne: "concluida" },
  $expr: { $lt: ["$quantidadeExecutada", "$quantidade"] }
}).sort({ dataCriacao: -1 });

    console.log(`[GET_ACTION] ${pedidos.length} pedidos locais encontrados`);

    for (const pedido of pedidos) {
      const id_action = pedido._id;

      const jaFez = await ActionHistory.findOne({
        id_action,
        id_conta: id_tiktok,
        acao_validada: { $in: [true, null] }
      });

      if (jaFez) {
        console.log(`[GET_ACTION] Ação local já feita para pedido ${id_action}, pulando`);
        continue;
      }

      const feitas = await ActionHistory.countDocuments({
        id_action,
        acao_validada: { $in: [true, null] }
      });

      if (feitas >= pedido.quantidade) {
        console.log(`[GET_ACTION] Limite atingido para pedido ${id_action}, pulando`);
        continue;
      }

      console.log("[GET_ACTION] Ação local encontrada:", pedido.link);

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

    console.log("[GET_ACTION] Nenhuma ação local válida encontrada, buscando na API externa...");

    const apiURL = `https://api.ganharnoinsta.com/get_action.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&id_conta=${id_tiktok}&is_tiktok=1&tipo=1`;
    const response = await axios.get(apiURL);
    const data = response.data;

    if (data.status === "CONTA_INEXISTENTE") {
      console.log("[GET_ACTION] Conta inexistente na API externa:", id_tiktok);
      return res.status(200).json({ status: "fail", id_tiktok, message: "conta_inexistente" });
    }

if (data.status === "ENCONTRADA") {
  const pontos = parseFloat(data.quantidade_pontos);
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
    return res.status(204).json({ message: "Nenhuma ação disponível no momento." });

  } catch (err) {
    console.error("[GET_ACTION] Erro ao buscar ação:", err);
    return res.status(500).json({ error: "Erro interno ao buscar ação" });
  }
  
};

if (url.startsWith("/api/confirm_action") && method === "POST") {
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

    // 🔍 Verificar se a ação é local (existe no Pedido)
    const pedidoLocal = await Pedido.findById(id_action);

    let valorFinal = 0;
    let tipo_acao = 'Seguir';
    let url_dir = '';

    if (pedidoLocal) {
      // ✅ AÇÃO LOCAL
      console.log("📦 Confirmando ação local:", id_action);

      const valorBruto = pedidoLocal.valor / 1000;
      const valorDescontado = valorBruto > 0.004 ? valorBruto - 0.001 : valorBruto;
      valorFinal = parseFloat(Math.min(Math.max(valorDescontado, 0.004), 0.006).toFixed(3));
      tipo_acao = 'Seguir';
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
        token: "afc012ec-a318-433d-b3c0-5bf07cd29430",
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
      tipo_acao = confirmData.tipo_acao || tempAction?.tipo_acao || 'Seguir';
      url_dir = tempAction?.url_dir || '';
    }

    const newAction = new ActionHistory({
      token,
      nome_usuario: usuario.contas.find(c => c.id_tiktok === id_tiktok)?.nomeConta || "desconhecido",
      tipo_acao,
      quantidade_pontos: valorFinal,
      url_dir,
      id_conta: id_tiktok,
      id_action,
      user: usuario._id,
      acao_validada: null,
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

    return res.status(404).json({ error: "Rota não encontrada." });
}
