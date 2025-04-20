import axios from "axios";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido. Use POST." });
    }

    try {
        const { id_conta, id_pedido } = req.body;

        // Verificando se os dados obrigatórios foram enviados
        if (!id_conta || !id_pedido) {
            return res.status(400).json({ error: "ID da conta e ID do pedido são obrigatórios." });
        }

        // Configurando o payload para enviar à API externa
        const confirmUrl = "https://api.ganharnoinsta.com/confirm_action.php";

        const payload = {
            token: "afc012ec-a318-433d-b3c0-5bf07cd29430",  // Exemplo de token fixo
            sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",  // Exemplo de hash fixo
            id_conta: id_conta, // Usando id_conta da requisição
            id_pedido: id_pedido, // Usando id_pedido da requisição
            is_tiktok: "1"  // Confirmando que a ação é do TikTok
        };

        console.log("Enviando requisição para confirm_action com os seguintes dados:", payload);

        // Enviando a requisição POST para a API externa
        const confirmResponse = await axios.post(confirmUrl, payload, {
            headers: { "Content-Type": "application/json" }
        });

        console.log("Resposta da API confirm_action:", confirmResponse.data);

        // Verificando a resposta da API externa
        if (confirmResponse.data.status !== "success") {
            return res.status(400).json({ error: "Erro ao confirmar ação.", detalhes: confirmResponse.data });
        }

        // Retornando sucesso e os dados esperados para o frontend
        return res.status(200).json({
            status: "success",
            message: "CONFIRMOU_SUCESSO",
            valor: confirmResponse.data.valor // Retornando o valor exato da API externa
        });

    } catch (error) {
        // Tratando qualquer erro durante a requisição
        console.error("Erro na requisição confirm_action:", error.response?.data || error.message);
        return res.status(500).json({ error: "Erro na requisição confirm_action.", detalhes: error.response?.data });
    }
}
