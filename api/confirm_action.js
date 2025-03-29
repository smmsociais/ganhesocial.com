import axios from "axios";
import connectDB from "./db.js";
import User from "./User.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  // 🔹 Recebendo os dados do frontend
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

    // 🔹 Extrair unique_id da URL (ex: "https://www.tiktok.com/@wilson_c3" → "wilson_c3")
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
    }

    let acaoValida = false;

    if (userId) {
      // 🔹 Chamar API user/following para verificar se segue o perfil alvo
      try {
        const userFollowingResponse = await axios.get("https://tiktok-scraper7.p.rapidapi.com/user/following", {
          params: { user_id: userId, count: "200", time: "0" },
          headers: {
            'x-rapidapi-key': 'f3dbe81fe5msh5f7554a137e41f1p11dce0jsnabd433c62319',
            'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
          }
        });

        const followingList = userFollowingResponse.data?.data?.followings || [];
        acaoValida = followingList.some(following => following.unique_id.toLowerCase() === extractedUsername.toLowerCase());

        if (acaoValida) {
          console.log(`✅ Ação válida! ${nome_usuario} está seguindo ${extractedUsername}.`);
        } else {
          console.log(`❌ Ação inválida! ${nome_usuario} NÃO está seguindo ${extractedUsername}.`);
        }
      } catch (error) {
        console.error("Erro ao chamar user/following:", error.response?.data || error.message);
      }
    }

    // 🔹 Confirmar ação na API externa independente da validação
    const confirmUrl = "https://api.ganharnoinsta.com/confirm_action.php";
    const payload = {
      token: "afc012ec-a318-433d-b3c0-5bf07cd29430",
      sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
      id_conta: id_conta,
      id_pedido: id_pedido,
      is_tiktok: "1"
    };

    let confirmData;
    try {
      const confirmResponse = await axios.post(confirmUrl, payload);
      confirmData = confirmResponse.data;
      console.log("Resposta da API confirmar ação:", confirmData);
    } catch (error) {
      console.error("Erro ao confirmar ação:", error.response?.data || error.message);
      confirmData = { error: "Erro ao confirmar a ação." };
    }

    return res.status(200).json({
      status: "sucesso",
      message: acaoValida ? "Ação confirmada e validada!" : "Ação confirmada, mas usuário não segue o perfil.",
      acaoValida: acaoValida,
      dados: confirmData
    });

  } catch (error) {
    console.error("Erro ao processar requisição:", error.response?.data || error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}
