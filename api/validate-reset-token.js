import connectDB from "./db.js";
import { User } from "./User.js";

const handler = async (req, res) => {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        await connectDB();
        const token = req.query.token;

        if (!token) {
            return res.status(400).json({ error: "Token ausente" });
        }

        const usuario = await User.findOne({ resetPasswordToken: token });

        if (!usuario) {
            return res.status(401).json({ error: "Token inválido" });
        }

        const expiracao = usuario.resetPasswordExpires ? new Date(usuario.resetPasswordExpires) : null;
        if (expiracao && expiracao < new Date()) {
            return res.status(401).json({ error: "Token expirado" });
        }

        return res.json({ valid: true });

    } catch (error) {
        return res.status(500).json({ error: "Erro ao validar token" });
    }
};

export default handler;
