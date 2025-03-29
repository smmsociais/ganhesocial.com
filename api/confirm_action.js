import axios from "axios";
import connectDB from "./db.js";
import User from "./User.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  const { token, nome_usuario } = req.body;
  if (!token || !nome_usuario) {
    return res.status(400).json({ error: "Os parâmetros 'token' e 'nome_usuario' são obrigatórios." });
  }

  try {
    const usuario = await User.findOne({ token });

    if (!usuario || !usuario.id_conta) {
      return res.status(400).json({ error: "ID da conta não encontrado. Chame primeiro a API get_user." });
    }

    const id_conta = usuario.id_conta;

    // 🔹 Chamar API get_action
    const getActionUrl = `https://api.ganharnoinsta.com/get_action.php?token=${token}&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&id_conta=${id_conta}&is_tiktok=1&tipo=1`;
    const getActionResponse = await axios.get(getActionUrl);
    const getActionData = getActionResponse.data;

    if (!getActionData.acoes || getActionData.acoes.status !== "ENCONTRADA") {
      return res.status(400).json({ error: "Nenhuma ação encontrada para este usuário." });
    }

    const { id_pedido, nome_usuario: nomeAlvo } = getActionData.acoes;

    return res.status(200).json({
      status: "sucesso",
      message: `Ação encontrada para ${nome_usuario}.`,
      id_pedido,
      nomeAlvo
    });

  } catch (error) {
    console.error("Erro ao processar requisição:", error.response?.data || error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}
