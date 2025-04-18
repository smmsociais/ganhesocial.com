import axios from "axios";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    const { id_conta } = req.query;

    if (!id_conta) {
        return res.status(400).json({ error: "ID da conta é obrigatório." });
    }

    const url = `https://api.ganharnoinsta.com/get_action.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&id_conta=${id_conta}&is_tiktok=1&tipo=1`;

    try {
        const response = await axios.get(url);
        const data = response.data;

        if (data.status !== "ENCONTRADA") {
            return res.status(404).json({ error: "Nenhuma ação disponível no momento." });
        }

        // Processa os dados: avatar, valor final etc.
        const uniqueId = data.nome_usuario?.replace("@", "") ?? "";
        let avatar_url = null;

        try {
            const userInfoRes = await axios.get(`https://api.ganhesocial.com/api/user-info?unique_id=${uniqueId}`);
            avatar_url = userInfoRes.data?.user?.avatar_thumb?.url_list?.[0] ?? null;
        } catch (err) {
            console.warn("Erro ao buscar avatar do TikTok:", err.message);
        }

        const pontos = parseFloat(data.quantidade_pontos || 0);
        const valor_final = (pontos * 0.001).toFixed(3);

        // Retorna dados prontos para o frontend
        return res.status(200).json({
            nome_usuario: data.nome_usuario,
            perfil_url: `https://www.tiktok.com/${data.nome_usuario}`,
            avatar_url,
            quantidade_pontos: pontos,
            valor_final,
            id_pedido: data.id_pedido,
            tipo_acao: data.tipo_acao,
            // outros campos úteis se quiser
        });

    } catch (error) {
        console.error("Erro ao buscar ação:", error);
        return res.status(500).json({ error: "Erro ao buscar ação." });
    }
}
