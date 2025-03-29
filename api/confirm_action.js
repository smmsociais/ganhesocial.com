import axios from "axios";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    const { token, nome_usuario, id_pedido, id_conta } = req.body;

    if (!id_conta || !id_pedido) {
        console.error("Erro: id_conta ou id_pedido está indefinido!", { id_conta, id_pedido });
        return res.status(400).json({ error: "Dados inválidos. ID da conta ou ID do pedido ausente." });
    }

    try {
        const confirmUrl = "https://api.ganharnoinsta.com/confirm_action.php";
        const payload = {
            token: "afc012ec-a318-433d-b3c0-5bf07cd29430",
            sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
            id_conta: id_conta,
            id_pedido: id_pedido,
            is_tiktok: "1"
        };

        console.log("Enviando requisição para API externa:", payload);

        const response = await axios.post(confirmUrl, payload, {
            headers: { "Content-Type": "application/json" }
        });

        console.log("Resposta da API externa:", response.data);

        return res.status(200).json(response.data);
    } catch (error) {
        console.error("Erro ao confirmar ação:", error.response?.data || error.message);
        return res.status(500).json({ error: "Erro ao confirmar ação." });
    }
}
