import connectDB from "./db.js";
import { ActionHistory, User } from "./User.js";

export default async function handler(req, res) {
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
    unique_id_verificado,
    tipo_acao,
    quantidade_pontos
  } = req.body;

  if (!id_conta || !id_pedido || !nome_usuario || !unique_id_verificado) {
    return res.status(400).json({ error: "Campos obrigatórios ausentes." });
  }

  try {
    const novaAcao = new ActionHistory({
      user: usuario._id,
      id_conta,
      id_pedido,
      nome_usuario,
      url_dir,
      unique_id_verificado,
      tipo: tipo_acao || "Seguir",
      rede_social: "TikTok",
      valor_confirmacao: quantidade_pontos,
      acao_validada: null, // pendente
      data: new Date()
    });

    await novaAcao.save();

    res.status(201).json({
      status: "success",
      id_acao: novaAcao._id,
      message: "Ação registrada como pendente."
    });
  } catch (error) {
    console.error("Erro ao registrar ação pendente:", error);
    res.status(500).json({ error: "Erro ao registrar ação." });
  }
}
