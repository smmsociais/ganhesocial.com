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
    if (!usuario) {
      return res.status(403).json({ error: "Acesso negado. Token inválido." });
    }

    // 🔹 1. Chamar API bind_tk para obter o id_conta
    const bindUrl = `http://api.ganharnoinsta.com/bind_tk.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nome_usuario}`;
    const bindResponse = await axios.get(bindUrl);
    console.log("Resposta da API bind_tk:", bindResponse.data);
    const id_conta = bindResponse.data?.id_conta;

    if (!id_conta) {
      return res.status(400).json({ error: "Não foi possível obter o ID da conta." });
    }

    // 🔹 2. Chamar API get_action para obter a ação do usuário
    const getActionUrl = `https://api.ganharnoinsta.com/get_action.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&id_conta=${id_conta}&is_tiktok=1&tipo=1`;
    const getActionResponse = await axios.get(getActionUrl);
    console.log("Resposta da API get_action:", getActionResponse.data);
    const getActionData = getActionResponse.data;

    if (!getActionData.acoes || getActionData.acoes.status !== "ENCONTRADA") {
      return res.status(400).json({ error: "Nenhuma ação encontrada para este usuário." });
    }

    const { id_pedido, nome_usuario: nomeAlvo } = getActionData.acoes;

    // 🔹 3. Chamar a API confirm_action para validar a ação
    const confirmUrl = "https://api.ganharnoinsta.com/confirm_action.php";
    const params = new URLSearchParams({
      token: "afc012ec-a318-433d-b3c0-5bf07cd29430",
      sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
      id_conta,
      id_pedido,
      is_tiktok: "1",
    });

    console.log("Enviando requisição para confirm_action com os seguintes dados:", params.toString());

    const confirmResponse = await axios.post(confirmUrl, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    console.log("Resposta da API confirm_action:", confirmResponse.data);
    const confirmData = confirmResponse.data;

    if (confirmData.status !== "success") {
      return res.status(400).json({ error: "Erro ao confirmar ação.", detalhes: confirmData });
    }

    return res.status(200).json({
      status: "sucesso",
      message: `Ação validada com sucesso! ${nome_usuario} está seguindo ${nomeAlvo}.`,
      detalhes: confirmData,
    });
  } catch (error) {
    console.error("Erro ao processar requisição:", error.response?.data || error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição.", detalhes: error.response?.data || error.message });
  }
}
