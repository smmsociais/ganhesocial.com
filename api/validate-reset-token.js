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

        // Obtenha a data de expiração de forma consistente
        const expiracao = usuario.resetPasswordExpires;

        if (!expiracao) {
            return res.status(401).json({ error: "Data de expiração não encontrada" });
        }

        // Log para ver a data de expiração
        console.log("Data de expiração do token:", expiracao);

        // Data atual em UTC
        const agora = new Date().toISOString();

        // Log para ver a data atual
        console.log("Data atual (agora):", agora);

        // Converter para milissegundos desde 1970
        const expiracaoMs = new Date(expiracao).getTime();
        const agoraMs = new Date(agora).getTime();

        // Log para ver as datas em milissegundos
        console.log("Expiração em milissegundos:", expiracaoMs);
        console.log("Agora em milissegundos:", agoraMs);

        // Se a data atual for maior que a data de expiração, o token expirou
        if (agoraMs > expiracaoMs) {
            console.log("Token expirado.");
            return res.status(401).json({ error: "Link inválido ou expirado" });
        }

        // Se o token ainda estiver dentro do prazo de validade
        return res.json({ valid: true });

    } catch (error) {
        return res.status(500).json({ error: "Erro ao validar token" });
    }
};

export default handler;
