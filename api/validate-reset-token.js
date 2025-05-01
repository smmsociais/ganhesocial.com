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
            return res.status(401).json({ error: "Link inválido ou expirado" });
        }

        // Verifica a expiração do token, definindo 1 minuto de validade para teste
        const expiracao = usuario.resetPasswordExpires ? new Date(usuario.resetPasswordExpires) : null;
        const agora = new Date();
        const umMinuto = 1 * 60 * 1000; // 1 minuto em milissegundos

        // Se a data de expiração não for válida ou o token expirou
        if (expiracao && expiracao < agora) {
            return res.status(401).json({ error: "Token expirado" });
        }

        // Se o token ainda estiver dentro do prazo de 1 minuto
        return res.json({ valid: true });

    } catch (error) {
        return res.status(500).json({ error: "Erro ao validar token" });
    }
};

export default handler;
