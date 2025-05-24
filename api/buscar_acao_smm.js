import connectDB from './db.js';
import mongoose from 'mongoose';
import { User, ActionHistory, Pedido } from "./schema.js";

const handler = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { id_conta, token, tipo } = req.query;

  if (!id_conta || !token) {
    return res.status(400).json({ error: "id_conta e token são obrigatórios" });
  }

  try {
    await connectDB();

    const usuario = await User.findOne({ token });
    if (!usuario) {
      return res.status(401).json({ error: "Token inválido" });
    }

    const query = { quantidade: { $gt: 0 } };
    if (tipo) {
      query.tipo = tipo;
    }

    const pedidos = await Pedido.find(query).sort({ createdAt: -1 });

    for (const pedido of pedidos) {
      const id_pedido = pedido._id;

      const jaFez = await ActionHistory.findOne({
        id_pedido,
        id_conta,
        acao_validada: { $in: [true, null] }
      });

      if (jaFez) continue;

      const feitas = await ActionHistory.countDocuments({
        id_pedido,
        acao_validada: { $in: [true, null] }
      });

      if (feitas >= pedido.quantidade) continue;

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

    return res.json({ status: "NAO_ENCONTRADA" });

  } catch (error) {
    console.error("Erro ao buscar ação local:", error);
    return res.status(500).json({ error: "Erro interno" });
  }
};

export default handler;
