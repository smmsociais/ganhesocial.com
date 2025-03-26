import axios from "axios";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido. Use POST." });
    }

    try {
        // Garantir que o corpo da requisição está sendo lido corretamente
        const { id_conta, id_pedido } = req.body;

        if (!id_conta || !id_pedido) {
            return res.status(400).json({ error: "ID da conta e ID do pedido são obrigatórios." });
        }

        const url = "https://api.ganharnoinsta.com/confirm_action.php";
        const params = new URLSearchParams({
            token: "afc012ec-a318-433d-b3c0-5bf07cd29430",
            sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
            id_conta,
            id_pedido,
            is_tiktok: "1",
        });

        const response = await axios.post(url, params.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        res.json(response.data);
    } catch (error) {
        console.error("Erro ao confirmar ação:", error.response?.data || error.message);
        res.status(500).json({ error: "Erro ao confirmar ação." });
    }
}
