import axios from "axios";
import connectDB from "./db.js";
import { User } from "./User.js";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    // Conectar ao banco de dados
    await connectDB();

    // Obter parâmetros da query
    const { token, nome_usuario } = req.query;

    if (!token || !nome_usuario) {
        return res.status(400).json({ error: "Os parâmetros 'token' e 'nome_usuario' são obrigatórios." });
    }

    try {
        // Buscar usuário pelo token fixo salvo no MongoDB
        const usuario = await User.findOne({ token });

        if (!usuario) {
            return res.status(403).json({ error: "Acesso negado. Token inválido." });
        }

        // 🔹 Chamar a API bind_tk para obter o ID da conta
        const bindTkUrl = `http://api.ganharnoinsta.com/bind_tk.php?token=a03f2bba-55a0-49c5-b4e1-28a6d1ae0876&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nome_usuario}`;
        const bindResponse = await axios.get(bindTkUrl);
        const bindData = bindResponse.data;

        if (bindData.status !== "success" || !bindData.id_conta) {
            return res.status(400).json({ error: "Erro ao obter ID da conta." });
        }

        const id_conta = bindData.id_conta;

        // 🔹 Chamar a API get_action para buscar as ações disponíveis
        const getActionUrl = `https://api.ganharnoinsta.com/get_action.php?token=a03f2bba-55a0-49c5-b4e1-28a6d1ae0876&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&id_conta=${id_conta}&is_tiktok=1&tipo=1`;
        const actionResponse = await axios.get(getActionUrl);
        const actionData = actionResponse.data;

        // Retornar as ações obtidas
        return res.status(200).json({
            message: "Ações obtidas com sucesso!",
            id_conta,
            acoes: actionData
        });

    } catch (error) {
        console.error("Erro ao processar requisição:", error);
        return res.status(500).json({ error: "Erro interno ao processar requisição." });
    }
}
