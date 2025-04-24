import axios from "axios";
import connectDB from "./api/db.js";
import { User, ActionHistory } from "./api/User.js";

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
    await connectDB();

    const { token, id_tiktok } = req.query;

    if (!token || !id_tiktok) {
        console.warn("❌ Parâmetros ausentes:", { token, id_tiktok });
        return res.status(400).json({ error: "Os parâmetros 'token' e 'id_tiktok' são obrigatórios." });
    }

    try {
        const usuario = await User.findOne({ token });

        if (!usuario) {
            console.warn("❌ Token inválido:", token);
            return res.status(403).json({ error: "Acesso negado. Token inválido." });
        }

        const getActionUrl = `https://api.ganharnoinsta.com/get_action.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&id_conta=${id_tiktok}&is_tiktok=1&tipo=1`;
        const actionResponse = await axios.get(getActionUrl);
        const data = actionResponse.data;

        console.log("📦 Resposta da API externa get_action:", data);

        if (data.status === "CONTA_INEXISTENTE") {
            return res.status(200).json({
                status: "fail",
                id_tiktok,
                message: "conta_inexistente"
            });
        }

        if (data.status === "ENCONTRADA") {
            const pontos = parseFloat(data.quantidade_pontos);
            const valorBruto = pontos / 1000;
            const valorDescontado = (valorBruto > 0.004)
                ? valorBruto - 0.001
                : valorBruto;
            const valorFinal = Math.min(Math.max(valorDescontado, 0.004), 0.006).toFixed(3);

            const idPedidoOriginal = String(data.id_pedido).padStart(9, '0');
            const idPedidoModificado = idPedidoOriginal
                .split('')
                .map(d => d === '0' ? 'a' : String(Number(d) - 1))
                .join('');

            try {
                await redis.set(
                    `action:${id_tiktok}`,
                    JSON.stringify({
                        url_dir: data.url_dir,
                        nome_usuario: data.nome_usuario,
                        tipo_acao: data.tipo_acao,
                        valor: valorFinal,
                        id_perfil: data.id_alvo,
                        id_pedido: data.id_pedido
                    }),
                    { ex: 300 }
                );

                console.log("📥 Ação salva no Redis com chave:", `action:${id_tiktok}`);

            } catch (error) {
                console.error("💥 Erro ao salvar no Redis:", error);
                return res.status(500).json({ error: "Erro ao salvar dados no Redis." });
            }

            return res.status(200).json({
                status: "sucess",
                id_tiktok,
                id_action: idPedidoModificado,
                url: data.url_dir,
                id_perfil: data.id_alvo,
                nome_usuario: data.nome_usuario,
                tipo_acao: data.tipo_acao,
                valor: valorFinal
            });
        }

        console.log("⚠️ Nenhuma ação disponível no momento.");
        return res.status(204).json({ message: "Nenhuma ação disponível no momento." });

    } catch (error) {
        console.error("💥 Erro ao processar requisição:", error);
        return res.status(500).json({ error: "Erro interno ao processar requisição." });
    }
}

// Rota: /api/confirm_action (POST)
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

        const idPedidoOriginal = id_action
            .split('')
            .map(c => c === 'a' ? '0' : String(Number(c) + 1))
            .join('');

        let redisData = null;
        try {
            const cache = await redis.get(`action:${id_tiktok}`);
            console.log("📦 Conteúdo bruto do Redis:", cache);
            redisData = typeof cache === "object" ? cache : JSON.parse(cache);
        } catch (redisErr) {
            console.warn("⚠️ Não foi possível recuperar dados do Redis:", redisErr);
        }

        const payload = {
            token: "afc012ec-a318-433d-b3c0-5bf07cd29430",
            sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
            id_conta: id_tiktok,
            id_pedido: idPedidoOriginal,
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

        const valorOriginal = parseFloat(confirmData.valor || redisData?.valor || 0);
        const valorDescontado = valorOriginal > 0.004 ? valorOriginal - 0.001 : valorOriginal;
        const valorFinal = parseFloat(Math.min(Math.max(valorDescontado, 0.004), 0.006).toFixed(3));

        const newAction = new ActionHistory({
            token,
            nome_usuario: usuario.contas.find(c => c.id_tiktok === id_tiktok)?.nomeConta || "desconhecido",
            tipo_acao: confirmData.tipo_acao || redisData?.tipo_acao || 'Seguir',
            quantidade_pontos: valorFinal,
            url_dir: redisData?.url_dir || '',
            id_conta: id_tiktok,
            id_pedido: idPedidoOriginal,
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

    // Rota não encontrada
    return res.status(404).json({ error: "Rota não encontrada." });
}
