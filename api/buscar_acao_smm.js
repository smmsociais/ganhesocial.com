import connectDB from './db.js';
import mongoose from 'mongoose';
import { User, ActionHistory } from "./User.js";

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

    // 📡 Buscar ação disponível no smmsociais.com
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

    // 🔍 Verificação da ação
    if (!acao || acao.status !== "ENCONTRADA" || !acao.link || !acao._id) {
      return res.json({ status: "NAO_ENCONTRADA" });
    }

    // 🔁 Verifica se o usuário já registrou ação para esse pedido
    const acaoExistente = await ActionHistory.findOne({
      id_pedido: acao._id,
      id_conta,
      acao_validada: { $in: [null, true] }
    });

    if (acaoExistente) {
      return res.json({
        status: "JA_REGISTRADA",
        message: "Essa conta já registrou uma ação válida ou pendente para esse pedido."
      });
    }

    // ✅ Extração do nome de usuário do link
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

  } catch (error) {
    console.error("Erro ao buscar ação do smmsociais.com:", error);
    return res.status(500).json({ error: "Erro interno" });
  }
};

export default handler;
