import connectDB from "./db.js";
import Pedido from "./Pedido.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  const {
    userId,
    rede,
    tipo,
    nome,
    valor,
    quantidade,
    quantidadeExecutada,
    link,
    status,
    dataCriacao
  } = req.body;

  // Validação básica dos campos obrigatórios
  if (!userId || !quantidade) {
    return res.status(400).json({ error: "Campos obrigatórios ausentes." });
  }

  try {
    // Verifica se o pedido já existe para evitar duplicidade
    const pedidoExistente = await Pedido.findOne({ _id: req.body._id });
    if (pedidoExistente) {
      // Se já existe, atualiza os campos que quiser atualizar (opcional)
      pedidoExistente.quantidadeExecutada = quantidadeExecutada ?? pedidoExistente.quantidadeExecutada;
      pedidoExistente.status = status ?? pedidoExistente.status;
      await pedidoExistente.save();

      return res.status(200).json({ status: "atualizado", id: pedidoExistente._id });
    }

    // Cria um novo pedido
    const novoPedido = new Pedido({
      _id: req.body._id, // se enviar o id do smmsociais, mantenha mesmo _id para facilitar referência
      userId,
      rede,
      tipo,
      nome,
      valor,
      quantidade,
      quantidadeExecutada: quantidadeExecutada || 0,
      link,
      status: status || "pendente",
      dataCriacao: dataCriacao ? new Date(dataCriacao) : new Date()
    });

    await novoPedido.save();

    return res.status(201).json({ status: "criado", id: novoPedido._id });
  } catch (error) {
    console.error("Erro ao sincronizar pedido:", error);
    return res.status(500).json({ error: "Erro ao sincronizar pedido." });
  }
}
