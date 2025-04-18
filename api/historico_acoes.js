import connectDB from "./db.js";
import { ActionHistory } from "./User.js";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    try {
        // Buscar histórico com o usuário populado apenas para ter acesso à associação, caso queira mais tarde
        const historico = await ActionHistory.find().populate("user", "nome");

        // Retornar os dados com nome_usuario diretamente salvo no histórico
        const formattedData = historico.map(action => ({
            nome_usuario: action.nome_usuario, // ← já é o nome da conta usada (ex: "renisson042")
            acao_validada: action.acao_validada,
            valor_confirmacao: action.valor_confirmacao,
            data: action.data,
            rede_social: action.rede_social || "TikTok",
            tipo: action.tipo_acao || "Seguir",  // ← Corrigido para refletir o nome correto do campo
            url_dir: action.url_dir || null
        }));

        res.status(200).json(formattedData);
    } catch (error) {
        console.error("Erro ao buscar histórico de ações:", error);
        res.status(500).json({ error: "Erro ao buscar histórico de ações." });
    }
}
