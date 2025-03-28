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

        // 🔹 1. Chamar API get_action para obter a ação do usuário
        const getActionUrl = `http://api.ganharnoinsta.com/get_action.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nome_usuario}`;
        const getActionResponse = await axios.get(getActionUrl);
        const getActionData = getActionResponse.data;

        if (!getActionData.acoes || getActionData.acoes.status !== "ENCONTRADA") {
            return res.status(400).json({ error: "Nenhuma ação encontrada para este usuário." });
        }

        const { id_pedido, nome_usuario: nomeAlvo } = getActionData.acoes;

        // 🔹 2. Chamar API user/info para obter o ID do usuário TikTok
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
            console.error("Erro ao chamar a API user/info:", error);
            return res.status(500).json({ error: "Erro ao obter informações do usuário." });
        }

        if (!userId) {
            return res.status(400).json({ error: "ID do usuário TikTok não encontrado." });
        }

        // 🔹 3. Chamar API user/following para obter lista de usuários seguidos
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
            followingList = userFollowingResponse?.data?.data?.followings || [];
        } catch (error) {
            console.error("Erro ao chamar a API user/following:", error);
            return res.status(500).json({ error: "Erro ao obter lista de seguidores." });
        }

        // 🔹 4. Verificar se o nome de usuário alvo está na lista de seguidos
        const usuarioSeguido = followingList.some(f => f.unique_id === nomeAlvo);

        if (!usuarioSeguido) {
            return res.status(400).json({
                status: "inválida",
                message: `O usuário ${nome_usuario} não está seguindo ${nomeAlvo}.`
            });
        }

        // 🔹 5. Chamar a API confirm_action para validar a ação
        const confirmUrl = "https://api.ganharnoinsta.com/confirm_action.php";
        const params = new URLSearchParams({
            token: "afc012ec-a318-433d-b3c0-5bf07cd29430",
            sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
            id_conta: userId,
            id_pedido,
            is_tiktok: "1",
        });

try {
    const confirmResponse = await axios.post(confirmUrl, params);
    console.log("Resposta da API confirm_action:", confirmResponse.data);

    const confirmData = confirmResponse.data;

    if (confirmData.status !== "success") {
        return res.status(400).json({ error: "Erro ao confirmar ação." });
    }

    return res.status(200).json({
        status: "sucesso",
        message: `Ação validada com sucesso! ${nome_usuario} está seguindo ${nomeAlvo}.`,
        detalhes: confirmData
    });

} catch (error) {
    console.error("Erro ao processar requisição:", error);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
}
