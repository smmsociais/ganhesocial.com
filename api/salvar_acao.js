// api/salvar_acao.js
import connectDB from "./db.js";
import { ActionHistory } from "./User.js";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        return res.status(401).json({ error: "Token ausente." });
    }

    // Lista de tokens válidos (pode ser movido para um banco de dados ou variáveis de ambiente)
    const validTokens = [
        "dcc3476d7f5ec04d52589bc67e2b7527f20ab9a4a239dc8b7df4fc649498feb1"
    ];

    if (!validTokens.includes(token)) {
        return res.status(403).json({ error: "Token inválido." });
    }

    try {
        const { nome_usuario, acao_validada, valor_confirmacao, data } = req.body;

        const novaAcao = new ActionHistory({
            token, // Agora o token é o identificador da ação
            nome_usuario,
            acao_validada,
            valor_confirmacao,
            data: new Date(data)
        });

        await novaAcao.save();

        res.status(200).json({ message: "Ação salva com sucesso." });
    } catch (error) {
        console.error("Erro ao salvar ação:", error);
        res.status(500).json({ error: "Erro ao salvar ação." });
    }
}
