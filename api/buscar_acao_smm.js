import connectDB from './db.js';
import mongoose from 'mongoose';
import { User, ActionHistory, Pedido } from "./User.js";

const SMM_API_KEY = process.env.SMM_API_KEY;

const handler = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { id_conta, token } = req.query;

  if (!id_conta || !token) {
    return res.status(400).json({ error: "id_conta e token são obrigatórios" });
  }

  try {
    await connectDB();

    // 🔐 Validação do token
    const usuario = await User.findOne({ token });
    if (!usuario) {
      return res.status(401).json({ error: "Token inválido" });
    }

    // ⏱️ Limite de tentativas para evitar loop infinito
    const MAX_TENTATIVAS = 10;
    let tentativa = 0;

    while (tentativa < MAX_TENTATIVAS) {
      tentativa++;

      // 📡 Buscar ação disponível
      const response = await fetch('https://smmsociais.com/api/buscar_acao_disponivel', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${SMM_API_KEY}`
        }
      });

      if (!response.ok) {
        console.error("Erro na resposta do smmsociais.com:", response.statusText);
        return res.status(500).json({ error: "Erro ao buscar dados do SMM" });
      }

      const acao = await response.json();

      // ❌ Nenhuma ação disponível
      if (!acao || acao.status !== "ENCONTRADA" || !acao.link || !acao._id) {
        return res.json({ status: "NAO_ENCONTRADA" });
      }

      // ✅ Verifica se o usuário já realizou essa ação
      const jaRegistrada = await ActionHistory.findOne({
        id_pedido: acao._id,
        id_conta,
        acao_validada: { $in: [null, true] }
      });

      if (jaRegistrada) {
        // Tenta buscar outra ação
        continue;
      }

      // ✅ Verifica se ainda está dentro do limite de ações
      const pedidoIdMongo = mongoose.Types.ObjectId(acao._id);
      const pedido = await Pedido.findById(pedidoIdMongo);

      if (!pedido) {
        // Pula para a próxima tentativa
        continue;
      }

      const limite = parseInt(pedido.quantidade, 10) || 0;

      const countAcoes = await ActionHistory.countDocuments({
        id_pedido: acao._id,
        acao_validada: { $in: [true, "true", null] }
      });

      if (countAcoes >= limite) {
        // Limite já atingido, tenta buscar outro
        continue;
      }

      // ✅ Ação válida encontrada
      const nomeUsuario = acao.link.includes("@")
        ? acao.link.split("@")[1].split(/[/?#]/)[0]
        : "";

      return res.json({
        status: "ENCONTRADA",
        nome_usuario: nomeUsuario,
        quantidade_pontos: acao.valor,
        url_dir: acao.link,
        tipo_acao: acao.tipo,
        id_pedido: acao._id
      });
    }

    // ⚠️ Após todas as tentativas, nenhuma ação válida foi encontrada
    return res.json({
      status: "NAO_ENCONTRADA",
      message: "Nenhuma ação disponível após múltiplas tentativas"
    });

  } catch (error) {
    console.error("Erro ao buscar ação do smmsociais.com:", error);
    return res.status(500).json({ error: "Erro interno" });
  }
};

export default handler;
