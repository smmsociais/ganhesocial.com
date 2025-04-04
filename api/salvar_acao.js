import connectDB from "./db.js";
import { ActionHistory } from "./User.js";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Token ausente." });

    // Verificar se o token corresponde a um armazenado (pode ser em um banco de dados ou variável de ambiente)
    if (token !== process.env.VALID_TOKEN) {
        return res.status(403).json({ error: "Token inválido." });
    }

    try {
        const { nome_usuario, acao_validada, valor_confirmacao, data } = req.body;

        const novaAcao = new ActionHistory({
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
