import connectDB from "./db.js";
import { User, ActionHistory } from "./User.js";

const handler = async (req, res) => {
    await connectDB();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Não autorizado" });
    }

    const token = authHeader.split(" ")[1];

    try {
        // 🔹 Busca no banco de dados pelo token no ActionHistory
        const actionHistory = await ActionHistory.findOne({ token }).populate("user");

        if (!actionHistory) {
            return res.status(404).json({ error: "Histórico de ação não encontrado" });
        }

        if (!actionHistory.user) {
            return res.status(404).json({ error: "Usuário associado não encontrado" });
        }

        // 🔹 Retorna os dados do usuário associados ao ActionHistory
        res.json({
            nome_usuario: actionHistory.nome_usuario, // O nome está dentro do ActionHistory
            email: actionHistory.user.email, // O email está dentro do User associado
            token: actionHistory.token, // Retorna o token correto do histórico
        });

    } catch (error) {
        console.error("Erro ao carregar perfil:", error);
        res.status(500).json({ error: "Erro ao carregar perfil" });
    }
};

export default handler;
