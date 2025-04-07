import connectDB from "./db.js";
import { ActionHistory } from "./User.js";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    try {
        // Buscar todas as ações e popular o nome do usuário associado
        const historico = await ActionHistory.find().populate("user", "nome");

        // Enviar apenas os campos necessários
const formattedData = historico.map(action => ({
    nome_usuario: action.nome_usuario,
    nome_cadastrado: action.user?.nome || "Desconhecido",
    acao_validada: action.acao_validada,
    valor_confirmacao: action.valor_confirmacao,
    data: action.data,
    rede_social: action.rede_social || "TikTok",
    tipo: action.tipo || "Seguir",
    url_dir: action.url_dir || null  // 🔹 Adiciona a URL da ação
}));

        res.status(200).json(formattedData);
    } catch (error) {
        console.error("Erro ao buscar histórico de ações:", error);
        res.status(500).json({ error: "Erro ao buscar histórico de ações." });
    }
}
