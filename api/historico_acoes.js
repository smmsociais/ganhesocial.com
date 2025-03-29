import connectDB from "./db.js";
import { ActionHistory } from "./User.js";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    try {
        // Buscar todas as ações e popular o nome do usuário associado
        const historico = await ActionHistory.find().populate("user", "nome_usuario");

        // Enviar apenas os campos necessários
        const formattedData = historico.map(action => ({
            nome_usuario: action.user?.nome_usuario || "Desconhecido", // Nome do usuário da ação
            acao_validada: action.acao_validada,  // Status da ação
            valor_confirmacao: action.valor_confirmacao, // 🔹 Adicionar o valor confirmado
            data: action.data  // Data da ação
        }));

        res.status(200).json(formattedData);
    } catch (error) {
        console.error("Erro ao buscar histórico de ações:", error);
        res.status(500).json({ error: "Erro ao buscar histórico de ações." });
    }
}
