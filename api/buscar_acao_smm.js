import connectDB from './db.js';
import mongoose from 'mongoose';
import { User, ActionHistory, Pedido } from "./schema.js";

const handler = async (req, res) => {
  if (req.method !== "GET") {
    console.log("Método não permitido:", req.method);
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { id_conta, token, tipo } = req.query;

  console.log("➡️ Requisição recebida:");
  console.log("id_conta:", id_conta);
  console.log("token:", token);
  console.log("tipo:", tipo);

  if (!id_conta || !token) {
    console.log("❌ id_conta ou token ausentes");
    return res.status(400).json({ error: "id_conta e token são obrigatórios" });
  }

  try {
    await connectDB();
    console.log("✅ Conexão com o banco estabelecida");

    const usuario = await User.findOne({ token });
    if (!usuario) {
      console.log("❌ Token inválido");
      return res.status(401).json({ error: "Token inválido" });
    }

    const query = { quantidade: { $gt: 0 } };
    if (tipo) {
      query.tipo = tipo;
    }

    const pedidos = await Pedido.find(query).sort({ createdAt: -1 });
    console.log(`📦 ${pedidos.length} pedidos encontrados`);

    for (const pedido of pedidos) {
      const id_pedido = pedido._id;
      console.log("🔍 Verificando pedido:", id_pedido);

      const jaFez = await ActionHistory.findOne({
        id_pedido,
        id_conta,
        acao_validada: { $in: [true, null] }
      });

      if (jaFez) {
        console.log(`⏩ Ação já registrada para conta ${id_conta} no pedido ${id_pedido}`);
        continue;
      }

      const feitas = await ActionHistory.countDocuments({
        id_pedido,
        acao_validada: { $in: [true, null] }
      });

      console.log(`🔢 Pedido ${id_pedido} - ${feitas}/${pedido.quantidade} ações feitas`);

      if (feitas >= pedido.quantidade) {
        console.log(`⏩ Limite de ações atingido para pedido ${id_pedido}`);
        continue;
      }

      const nomeUsuario = pedido.link.includes("@")
        ? pedido.link.split("@")[1].split(/[/?#]/)[0]
        : "";

      console.log(`✅ Ação encontrada para ${nomeUsuario}`);

      return res.json({
        status: "ENCONTRADA",
        nome_usuario: nomeUsuario,
        quantidade_pontos: pedido.valor,
        url_dir: pedido.link,
        tipo_acao: pedido.tipo,
        id_pedido: pedido._id
      });
    }

    console.log("📭 Nenhuma ação disponível");
    return res.json({ status: "NAO_ENCONTRADA" });

  } catch (error) {
    console.error("❌ Erro ao buscar ação local:", error);
    return res.status(500).json({ error: "Erro interno" });
  }
};

export default handler;
