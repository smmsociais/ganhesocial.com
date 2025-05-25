import connectDB from './db.js';
import mongoose from 'mongoose';
import { User, ActionHistory, Pedido } from "./schema.js";

const handler = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { id_conta, token, tipo } = req.query;

  console.log("➡️ Requisição recebida:");
  console.log("id_conta:", id_conta);
  console.log("token:", token);
  console.log("tipo:", tipo);

  if (!id_conta || !token) {
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

    // 🔁 Mapeamento do tipo recebido para o tipo do banco
    const tipoMap = {
      seguir: "seguidores",
      curtir: "curtidas"
    };
    const tipoBanco = tipoMap[tipo] || tipo;

const query = {
  quantidade: { $gt: 0 },
  status: { $in: ["pendente", "reservada"] }
};
if (tipoBanco) query.tipo = tipoBanco;

const pedidos = await Pedido.find(query).sort({ dataCriacao: -1 });
console.log(`📦 ${pedidos.length} pedidos encontrados`);

    for (const pedido of pedidos) {
      const id_pedido = pedido._id;

      const jaFez = await ActionHistory.findOne({
        id_pedido,
        id_conta,
        acao_validada: { $in: [true, null] }
      });

      if (jaFez) {
        console.log(`⛔ Já realizou pedido ${id_pedido}`);
        continue;
      }

      const feitas = await ActionHistory.countDocuments({
        id_pedido,
        acao_validada: { $in: [true, null] }
      });

      if (feitas >= pedido.quantidade) {
        console.log(`⏩ Pedido ${id_pedido} já atingiu o limite (${feitas}/${pedido.quantidade})`);
        continue;
      }

      const nomeUsuario = pedido.link.includes("@")
        ? pedido.link.split("@")[1].split(/[/?#]/)[0]
        : "";

      console.log(`✅ Ação encontrada: ${nomeUsuario} (pedido ${id_pedido})`);

      return res.json({
        status: "ENCONTRADA",
        nome_usuario: nomeUsuario,
        quantidade_pontos: pedido.valor,
        url_dir: pedido.link,
        tipo_acao: tipo,
        id_pedido: pedido._id
      });
    }

    console.log("📭 Nenhuma ação disponível");
    return res.json({ status: "NAO_ENCONTRADA" });

  } catch (error) {
    console.error("🔥 Erro ao buscar ação:", error);
    return res.status(500).json({ error: "Erro interno" });
  }
};

export default handler;
