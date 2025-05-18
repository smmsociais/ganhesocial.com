import connectDB from './db.js';
import { ActionHistory } from './ActionHistory.js';
import Pedido from './Pedido.js';
import mongoose from 'mongoose';

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { authorization } = req.headers;
    const token = authorization?.split(" ")[1];

    if (!token || token !== process.env.SMM_API_KEY) {
      return res.status(401).json({ error: "Não autorizado" });
    }

    await connectDB();

    const {
      tipo_acao,
      nome_usuario,
      quantidade_pontos,
      url_dir,
      id_pedido,
      quantidade,
      valor
    } = req.body;

    if (
      !tipo_acao ||
      !nome_usuario ||
      quantidade_pontos === undefined ||
      !url_dir ||
      !id_pedido ||
      quantidade === undefined ||
      valor === undefined
    ) {
      return res.status(400).json({ error: "Dados incompletos" });
    }

    const pontos = parseFloat(quantidade_pontos);
    const qtd = parseInt(quantidade);
    const val = parseFloat(valor);

    if (isNaN(pontos) || pontos <= 0) {
      return res.status(400).json({ error: "Quantidade de pontos inválida" });
    }
    if (isNaN(qtd) || qtd <= 0) {
      return res.status(400).json({ error: "Quantidade inválida" });
    }
    if (isNaN(val) || val <= 0) {
      return res.status(400).json({ error: "Valor inválido" });
    }

    // Verifica se já existe alguma ação com esse id_pedido
    const jaExiste = await ActionHistory.findOne({ id_pedido });
    if (jaExiste) {
      return res.status(409).json({ error: "Ação já cadastrada" });
    }

    // Converte id_pedido para ObjectId
    let pedidoObjectId;
    try {
      pedidoObjectId = new mongoose.Types.ObjectId(id_pedido);
    } catch {
      return res.status(400).json({ error: "id_pedido inválido" });
    }

    // Procura o Pedido pelo _id do Mongo (não pelo campo id_pedido)
    const pedidoExistente = await Pedido.findById(pedidoObjectId);

    if (!pedidoExistente) {
      // Cria o Pedido usando _id = id_pedido convertido para ObjectId
      const novoPedido = new Pedido({
        _id: pedidoObjectId,
        rede: "tiktok",
        tipo: tipo_acao.toLowerCase() === "seguir" ? "seguidores" : tipo_acao.toLowerCase(),
        nome: `Ação ${tipo_acao} - ${nome_usuario}`,
        valor: val,
        quantidade: qtd,
        quantidadeExecutada: 0,
        link: url_dir,
        status: "pendente",
        dataCriacao: new Date(),
        userId: null
      });

      await novoPedido.save();
    }

    // Agora registra a ação no histórico
    const novaAcao = new ActionHistory({
      tipo_acao,
      nome_usuario,
      quantidade_pontos: pontos,
      url_dir,
      id_pedido,  // ainda salva como string para referência, mas Pedido está no _id
      quantidade: qtd,
      valor: val,
      status: "pendente",
      acao_validada: null,
      valor_confirmacao: "0",
      rede_social: "TikTok",
      tipo: tipo_acao
    });

    await novaAcao.save();

    console.log("✅ Nova ação registrada:", { tipo_acao, nome_usuario, id_pedido, pontos });

    return res.status(201).json({ message: "Ação adicionada com sucesso" });

  } catch (error) {
    console.error("❌ Erro ao adicionar ação:", {
      message: error.message,
      stack: error.stack,
      detalhes: error
    });
    return res.status(500).json({ error: "Erro interno ao adicionar ação" });
  }
};

export default handler;
