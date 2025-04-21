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

  if (!id_conta || !id_pedido || !nome_usuario || !tipo_acao || quantidade_pontos == null) {
    return res.status(400).json({ error: "Campos obrigatórios ausentes." });
  }

  try {
    // 🔢 Lógica para calcular valor final baseado nos pontos
    const pontos = parseFloat(quantidade_pontos);
    const valorBruto = pontos / 1000;
    const valorDescontado = (valorBruto > 0.004)
      ? valorBruto - 0.001
      : valorBruto;
    const valorFinal = Math.min(Math.max(valorDescontado, 0.004), 0.006).toFixed(3);

    const novaAcao = new ActionHistory({
      user: usuario._id,
      token: usuario.token,
      nome_usuario,
      id_pedido,
      id_conta,
      url_dir,
      tipo_acao,
      quantidade_pontos,
      tipo: tipo_acao || "Seguir",
      rede_social: "TikTok",
      valor_confirmacao: valorFinal, // ✅ valor calculado aqui
      acao_validada: null,
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
