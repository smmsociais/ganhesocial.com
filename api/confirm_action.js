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
    console.log("🔹 Iniciando requisição - Usuário:", nome_usuario);
    
    const usuario = await User.findOne({ token });
    if (!usuario) {
      console.warn("⚠️ Token inválido para usuário:", nome_usuario);
      return res.status(403).json({ error: "Acesso negado. Token inválido." });
    }

    // 🔹 1. Chamar API get_action
    const getActionUrl = `http://api.ganharnoinsta.com/get_action.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nome_usuario}`;
    console.log("🔹 Chamando API get_action:", getActionUrl);
    
    const getActionResponse = await axios.get(getActionUrl);
    console.log("🔹 Resposta get_action:", getActionResponse.data);

    const getActionData = getActionResponse.data;
    if (!getActionData.acoes || getActionData.acoes.status !== "ENCONTRADA") {
      console.warn("⚠️ Nenhuma ação encontrada para:", nome_usuario);
      return res.status(400).json({ error: "Nenhuma ação encontrada para este usuário." });
    }

    const { id_pedido, nome_usuario: nomeAlvo } = getActionData.acoes;

    // 🔹 2. Chamar API user/info
    try {
      console.log("🔹 Chamando API user/info para:", nome_usuario);
      const userInfoResponse = await axios.get("https://tiktok-scraper7.p.rapidapi.com/user/info", {
        params: { unique_id: nome_usuario },
        headers: {
          'x-rapidapi-key': 'f3dbe81fe5msh5f7554a137e41f1p11dce0jsnabd433c62319',
          'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
        }
      });
      console.log("🔹 Resposta user/info:", userInfoResponse.data);

      const userId = userInfoResponse?.data?.data?.user?.id;
      if (!userId) {
        console.warn("⚠️ ID do usuário TikTok não encontrado para:", nome_usuario);
        return res.status(400).json({ error: "ID do usuário TikTok não encontrado." });
      }

      // 🔹 3. Chamar API user/following
      console.log("🔹 Chamando API user/following para ID:", userId);
      const userFollowingResponse = await axios.get("https://tiktok-scraper7.p.rapidapi.com/user/following", {
        params: { user_id: userId, count: "200", time: "0" },
        headers: {
          'x-rapidapi-key': 'f3dbe81fe5msh5f7554a137e41f1p11dce0jsnabd433c62319',
          'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
        }
      });
      console.log("🔹 Resposta user/following:", userFollowingResponse.data);

      const followingList = userFollowingResponse?.data?.data?.followings || [];
      const usuarioSeguido = followingList.some(f => f.unique_id === nomeAlvo);
      if (!usuarioSeguido) {
        console.warn(`⚠️ ${nome_usuario} NÃO está seguindo ${nomeAlvo}`);
        return res.status(400).json({ status: "inválida", message: `O usuário ${nome_usuario} não está seguindo ${nomeAlvo}.` });
      }

      // 🔹 4. Chamar API confirm_action
      const confirmUrl = "https://api.ganharnoinsta.com/confirm_action.php";
      const params = new URLSearchParams({
        token: "afc012ec-a318-433d-b3c0-5bf07cd29430",
        sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
        id_conta: userId,
        id_pedido,
        is_tiktok: "1"
      });

      console.log("🔹 Enviando confirmação de ação para:", confirmUrl);
      console.log("🔹 Parâmetros enviados:", params.toString());

      const confirmResponse = await axios.post(confirmUrl, params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      });

      console.log("🔹 Resposta confirm_action:", confirmResponse.data);
      if (confirmResponse.data.status !== "success") {
        console.warn("⚠️ Falha ao confirmar ação:", confirmResponse.data);
        return res.status(400).json({ error: "Erro ao confirmar ação.", detalhes: confirmResponse.data });
      }

      console.log("✅ Ação validada com sucesso para:", nome_usuario);
      return res.status(200).json({
        status: "sucesso",
        message: `Ação validada com sucesso! ${nome_usuario} está seguindo ${nomeAlvo}.`,
        detalhes: confirmResponse.data
      });
    } catch (error) {
      console.error("❌ Erro ao chamar APIs externas:", error.response?.data || error.message);
      return res.status(500).json({ error: "Erro ao processar requisição.", detalhes: error.response?.data || error.message });
    }
  } catch (error) {
    console.error("❌ Erro inesperado no servidor:", error);
    return res.status(500).json({ error: "Erro interno ao processar requisição.", detalhes: error.message });
  }
}
