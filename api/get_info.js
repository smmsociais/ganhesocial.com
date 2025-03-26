import axios from "axios";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    // Obter o token do cabeçalho
    const authToken = req.headers.authorization;

    // Validar se o token corresponde ao token fixo
    if (!authToken || authToken !== `Bearer ${process.env.API_SECRET_TOKEN}`) {
        return res.status(403).json({ error: "Acesso negado. Token inválido." });
    }

    // Obter parâmetros da query
    const { nome_usuario } = req.query;

    if (!nome_usuario) {
        return res.status(400).json({ error: "O parâmetro 'nome_usuario' é obrigatório." });
    }

    try {
        // Chamar a API bind_tk para obter o ID da conta
        const bindTkUrl = `http://api.ganharnoinsta.com/bind_tk.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nome_usuario}`;

        const bindResponse = await axios.get(bindTkUrl);
        const bindData = bindResponse.data;

        if (bindData.status !== "success") {
            return res.status(400).json({ error: "Erro ao vincular conta.", detalhes: bindData });
        }

        // Retorna a resposta da API bind_tk com ID da conta
        return res.status(200).json({ 
            message: "Conta vinculada com sucesso!", 
            id_conta: bindData.id_conta,
            detalhes: bindData
        });

    } catch (error) {
        console.error("Erro ao processar requisição:", error);
        return res.status(500).json({ error: "Erro interno ao processar requisição." });
    }
}
