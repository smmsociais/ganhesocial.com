import axios from "axios";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    // Extrair parâmetros da query string
    const { token, nome_usuario } = req.query;

    if (!token || !nome_usuario) {
        return res.status(400).json({ error: "Parâmetros 'token' e 'nome_usuario' são obrigatórios." });
    }

    // Construir a URL para chamar a API externa bind_tk
    const url = `http://api.ganharnoinsta.com/bind_tk.php?token=${token}&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nome_usuario}`;

    try {
        const response = await axios.get(url);
        const data = response.data;

        if (data.status === "success") {
            // Retorna os dados obtidos da API externa (pode incluir id_conta e demais informações)
            return res.status(200).json({ id_conta: data.id_conta, ...data });
        } else {
            return res.status(400).json({ error: "Erro ao obter informações da conta." });
        }
    } catch (error) {
        console.error("Erro ao obter informações da conta:", error.message);
        return res.status(500).json({ error: "Erro interno ao obter informações da conta." });
    }
}
