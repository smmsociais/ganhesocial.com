import axios from "axios";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    const { token, nome_usuario, id_pedido, id_conta } = req.body;

    if (!token || !nome_usuario || !id_pedido || !id_conta) {
        return res.status(400).json({ error: "Dados inválidos. Todos os campos são obrigatórios." });
    }

    try {
        // 🔹 1. Chamar API user/info para obter detalhes do usuário no TikTok
        const userInfoResponse = await axios.get("https://tiktok-scraper7.p.rapidapi.com/user/info", {
            params: { unique_id: nome_usuario },
            headers: {
                "x-rapidapi-key": "f3dbe81fe5msh5f7554a137e41f1p11dce0jsnabd433c62319",
                "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com"
            }
        });

        console.log("Resposta da API user/info:", userInfoResponse.data);

        // 🔹 2. Verificar se a resposta da API user/info é válida
        if (!userInfoResponse.data || !userInfoResponse.data.success) {
            return res.status(400).json({ error: "Usuário TikTok não encontrado." });
        }

        // 🔹 3. Chamar API externa para confirmar ação
        const confirmUrl = "https://api.ganharnoinsta.com/confirm_action.php";
        const payload = {
            token: "afc012ec-a318-433d-b3c0-5bf07cd29430",
            sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
            id_conta: id_conta,
            id_pedido: id_pedido,
            is_tiktok: "1"
        };

        const confirmResponse = await axios.post(confirmUrl, payload);

        console.log("Resposta da API confirmar ação:", confirmResponse.data);

        return res.status(200).json(confirmResponse.data);
    } catch (error) {
        console.error("Erro ao processar a confirmação:", error);
        return res.status(500).json({ error: "Erro ao processar a solicitação." });
    }
}
