import jwt from "jsonwebtoken";
import connectDB from "./db.js";
import User from "./User.js";

const handler = async (req, res) => {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    await connectDB();

    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "Token não fornecido" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const usuario = await User.findById(decoded.id);

        if (!usuario) {
            return res.status(404).json({ error: "Usuário não encontrado" });
        }

        res.json({ nome: usuario.nome_usuario, email: usuario.email });
    } catch (error) {
        console.error("❌ Erro ao buscar dados do usuário:", error);
        res.status(401).json({ error: "Token inválido" });
    }
};

export default handler;
