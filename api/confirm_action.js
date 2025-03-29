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
    // Buscar usuário pelo token fixo salvo no MongoDB
    const usuario = await User.findOne({ token });
    if (!usuario) {
      return res.status(403).json({ error: "Acesso negado. Token inválido." });
    }

    // 1. Chamar API get_action para obter a ação do usuário
    const getActionUrl = `https://ganhesocial.com/api/get_action?token=${token}&nome_usuario=${nome_usuario}&id_conta=${usuario.id_conta || ''}&is_tiktok=1&tipo=1`;
    const getActionResponse = await axios.get(getActionUrl);
    const getActionData = getActionResponse.data;
    console.log("Resposta de get_action:", getActionData);

    if (!getActionData.acoes || !getActionData.acoes.url_dir) {
      return res.status(400).json({ error: "Nenhuma ação encontrada para este usuário." });
    }

    // Extrair o nome de usuário da URL (url_dir) – espera-se algo como "https://www.tiktok.com/@wilson_c3"
    let urlDir = getActionData.acoes.url_dir;
    let extractedUsername = urlDir.split("/").pop(); // Ex: "@wilson_c3"
    if (extractedUsername.startsWith("@")) {
      extractedUsername = extractedUsername.slice(1);
    }
    console.log("Username extraído do url_dir:", extractedUsername);

    // 2. Chamar API user/info para obter o ID do usuário TikTok (opcional se necessário)
    let userInfo = null;
    let userId = null;
    try {
      const userInfoResponse = await axios.get("https://tiktok-scraper7.p.rapidapi.com/user/info", {
        params: { unique_id: nome_usuario },
        headers: {
          'x-rapidapi-key': 'f3dbe81fe5msh5f7554a137e41f1p11dce0jsnabd433c62319',
          'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
        }
      });
      userInfo = userInfoResponse.data;
      userId = userInfo?.data?.user?.id || null;
    } catch (error) {
      console.error("Erro ao chamar a API user/info:", error.response?.data || error.message);
      return res.status(500).json({ error: "Erro ao obter informações do usuário." });
    }
    if (!userId) {
      return res.status(400).json({ error: "ID do usuário TikTok não encontrado." });
    }

    // 3. Chamar API user/following para obter a lista de usuários seguidos
    let followingList = [];
    try {
      const userFollowingResponse = await axios.get("https://tiktok-scraper7.p.rapidapi.com/user/following", {
        params: {
          user_id: userId,
          count: "200",
          time: "0"
        },
        headers: {
          'x-rapidapi-key': 'f3dbe81fe5msh5f7554a137e41f1p11dce0jsnabd433c62319',
          'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
        }
      });
      console.log("Resposta de user/following:", JSON.stringify(userFollowingResponse.data, null, 2));
      followingList = userFollowingResponse.data?.data?.followings || [];
    } catch (error) {
      console.error("Erro ao chamar a API user/following:", error.response?.data || error.message);
      return res.status(500).json({ error: "Erro ao obter lista de seguidores." });
    }

    // 4. Verificar se o nome extraído (unique_id) está na lista de seguidores
    const acaoValida = followingList.some(following =>
      following.unique_id.toLowerCase() === extractedUsername.toLowerCase()
    );

    if (acaoValida) {
      // Ação válida: usuário segue o perfil
      return res.status(200).json({
        status: "sucesso",
        message: `Ação válida! ${nome_usuario} está seguindo ${extractedUsername}.`,
        detalhes: getActionData.acoes
      });
    } else {
      // Ação inválida: não encontrou o username na lista de seguidores
      return res.status(400).json({
        status: "inválida",
        message: `Ação inválida! ${nome_usuario} NÃO está seguindo ${extractedUsername}.`
      });
    }
  } catch (error) {
    console.error("Erro ao processar requisição:", error.response?.data || error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}
