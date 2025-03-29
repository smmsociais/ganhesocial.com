import axios from "axios";
import connectDB from "./db.js";
import User from "./User.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  // 🔹 Recebe os dados do frontend (get_action já foi chamado externamente)
  const { token, nome_usuario, id_pedido, id_conta, url_dir } = req.body;

  if (!token || !nome_usuario || !id_pedido || !id_conta || !url_dir) {
    return res.status(400).json({ error: "Parâmetros obrigatórios ausentes." });
  }

  try {
    // 🔹 Buscar usuário pelo token no MongoDB
    const usuario = await User.findOne({ token });
    if (!usuario) {
      return res.status(403).json({ error: "Acesso negado. Token inválido." });
    }

    // 🔹 Extrair nome de usuário da URL (ex: "https://www.tiktok.com/@wilson_c3" → "wilson_c3")
    let extractedUsername = url_dir.split("/").pop();
    if (extractedUsername.startsWith("@")) {
      extractedUsername = extractedUsername.slice(1);
    }
    console.log("Username extraído do url_dir:", extractedUsername);

    // 🔹 Chamar API user/info para obter ID do usuário TikTok
    let userId;
    try {
      const userInfoResponse = await axios.get("https://tiktok-scraper7.p.rapidapi.com/user/info", {
        params: { unique_id: nome_usuario },
        headers: {
          'x-rapidapi-key': 'f3dbe81fe5msh5f7554a137e41f1p11dce0jsnabd433c62319',
          'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
        }
      });
      userId = userInfoResponse.data?.data?.user?.id || null;
    } catch (error) {
      console.error("Erro ao chamar user/info:", error.response?.data || error.message);
      return res.status(500).json({ error: "Erro ao obter informações do usuário." });
    }

    if (!userId) {
      return res.status(400).json({ error: "ID do usuário TikTok não encontrado." });
    }

    // 🔹 Chamar API user/following para verificar se segue o perfil alvo
    let followingList = [];
    try {
      const userFollowingResponse = await axios.get("https://tiktok-scraper7.p.rapidapi.com/user/following", {
        params: { user_id: userId, count: "200", time: "0" },
        headers: {
          'x-rapidapi-key': 'f3dbe81fe5msh5f7554a137e41f1p11dce0jsnabd433c62319',
          'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
        }
      });
      followingList = userFollowingResponse.data?.data?.followings || [];
    } catch (error) {
      console.error("Erro ao chamar user/following:", error.response?.data || error.message);
      return res.status(500).json({ error: "Erro ao obter lista de seguidores." });
    }

    // 🔹 Verificar se segue o perfil
    const acaoValida = followingList.some(following => following.unique_id.toLowerCase() === extractedUsername.toLowerCase());

    if (acaoValida) {
      return res.status(200).json({
        status: "sucesso",
        message: `Ação válida! ${nome_usuario} está seguindo ${extractedUsername}.`,
        id_pedido
      });
    } else {
      return res.status(400).json({
        status: "inválida",
        message: `Ação inválida! ${nome_usuario} NÃO está seguindo ${extractedUsername}.`,
        id_pedido
      });
    }
  } catch (error) {
    console.error("Erro ao processar requisição:", error.response?.data || error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}
