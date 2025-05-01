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

        // Data atual em UTC (forçar para UTC)
        const agora = new Date().toISOString();

        // Log para ver a data atual
        console.log("Data atual (agora):", agora);

        // Converter para milissegundos desde 1970
        const expiracaoMs = new Date(expiracao).getTime();
        const agoraMs = new Date(agora).getTime();

        // Log para ver as datas em milissegundos
        console.log("Expiração em milissegundos:", expiracaoMs);
        console.log("Agora em milissegundos:", agoraMs);

        // Se o token expirou (com base na data de expiração armazenada)
        if (expiracaoMs < agoraMs) {
            console.log("Token expirado, expirado antes de agora.");
            return res.status(401).json({ error: "Token expirado" });
        }

        // Para teste: token expira em 1 minuto
        const umMinuto = 1 * 60 * 1000; // 1 minuto em milissegundos
        const tempoDecorrido = agoraMs - expiracaoMs;

        // Log para ver o tempo decorrido
        console.log("Tempo decorrido desde a expiração:", tempoDecorrido);

        // Verifica se o token expirou após 1 minuto
        if (tempoDecorrido > umMinuto) {
            console.log("Token expirado após 1 minuto.");
            return res.status(401).json({ error: "Token expirado após 1 minuto" });
        }

        // Se o token estiver dentro do prazo de validade
        return res.json({ valid: true });

    } catch (error) {
        return res.status(500).json({ error: "Erro ao validar token" });
    }
};

export default handler;
