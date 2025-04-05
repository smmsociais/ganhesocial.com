import connectDB from "./db.js";
import { User } from "./User.js";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    const { token } = req.query;
    if (!token) {
        return res.status(400).json({ error: "Token obrigatório." });
    }

    try {
        const usuario = await User.findOne({ token }).select("ganhosPorDia saldo");
        if (!usuario) {
            return res.status(403).json({ error: "Acesso negado." });
        }

        const ganhosMap = new Map();

        // Mapeia os ganhos, ajustando para UTC-3 (meia-noite no Brasil = 21h UTC)
for (const ganho of usuario.ganhosPorDia || []) {
    const localData = new Date(ganho.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const data = new Date(localData);
    data.setHours(0, 0, 0, 0);
    const dataFormatada = data.toISOString().split("T")[0];
    ganhosMap.set(dataFormatada, ganho.valor);
}


        const historico = [];

        // Data de hoje em UTC-3
const hojeLocal = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const hoje = new Date(hojeLocal);
hoje.setHours(0, 0, 0, 0);

for (let i = 0; i < 30; i++) {
    const data = new Date(hoje);
    data.setDate(data.getDate() - i);
    data.setHours(0, 0, 0, 0);

    const dataFormatada = data.toISOString().split("T")[0];
    const valor = ganhosMap.get(dataFormatada) || 0;

    historico.push({ data: dataFormatada, valor });
}

        historico.reverse(); // Do mais antigo pro mais recente

        res.status(200).json({ historico });
    } catch (error) {
        console.error("Erro ao obter histórico de ganhos:", error);
        res.status(500).json({ error: "Erro ao buscar histórico de ganhos." });
    }
}
