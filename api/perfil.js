import connectDB from "./db.js";
import User from "./User.js";

const handler = async (req, res) => {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    await connectDB();

    const token = req.headers.authorization?.split(" ")[1]; // Pega o token enviado no cabeçalho

    if (!token) {
        return res.status(401).json({ error: "Token não fornecido" });
    }

    try {
        console.log("🔍 Buscando usuário pelo token fixo...");
        const usuario = await User.findOne({ token });

        if (!usuario) {
            return res.status(404).json({ error: "Usuário não encontrado" });
        }

        res.json({ nome: usuario.nome_usuario, email: usuario.email, token: usuario.token });
    } catch (error) {
        console.error("❌ Erro ao buscar dados do usuário:", error);
        res.status(500).json({ error: "Erro interno no servidor" });
    }
};

export default handler;
