import connectDB from './db.js';
import mongoose from 'mongoose';
import { User, ActionHistory, Pedido } from "./schema.js";

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

    // 🔍 Buscar pedidos com quantidade > 0
    const pedidos = await Pedido.find({ quantidade: { $gt: 0 } }).sort({ createdAt: -1 });

    for (const pedido of pedidos) {
      const id_pedido = pedido._id;

      // ❌ Já realizou essa ação?
      const jaFez = await ActionHistory.findOne({
        id_pedido,
        id_conta,
        acao_validada: { $in: [true, null] }
      });

      if (jaFez) continue;

      // 🔢 Quantas já foram feitas
      const feitas = await ActionHistory.countDocuments({
        id_pedido,
        acao_validada: { $in: [true, null] }
      });

      if (feitas >= pedido.quantidade) continue;

      // ✅ Ação disponível!
      const nomeUsuario = pedido.link.includes("@")
        ? pedido.link.split("@")[1].split(/[/?#]/)[0]
        : "";

      return res.json({
        status: "ENCONTRADA",
        nome_usuario: nomeUsuario,
        quantidade_pontos: pedido.valor,
        url_dir: pedido.link,
        tipo_acao: pedido.tipo,
        id_pedido: pedido._id
      });
    }

    // ❌ Nenhuma ação válida encontrada
    return res.json({ status: "NAO_ENCONTRADA" });

  } catch (error) {
    console.error("Erro ao buscar ação local:", error);
    return res.status(500).json({ error: "Erro interno" });
  }
};

export default handler;
