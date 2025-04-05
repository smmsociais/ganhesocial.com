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
        for (const ganho of usuario.ganhosPorDia || []) {
            ganhosMap.set(ganho.data, ganho.valor);
        }

        const historico = [];
        const hoje = new Date();

        for (let i = 0; i < 30; i++) {
            const data = new Date();
            data.setDate(hoje.getDate() - i);
            const dataFormatada = data.toISOString().split("T")[0]; // YYYY-MM-DD

            const valor = ganhosMap.get(dataFormatada) || 0;
            historico.push({ data: dataFormatada, valor });
        }

        // Ordenar por data crescente (opcional)
        historico.reverse();

        res.status(200).json({ historico });
    } catch (error) {
        console.error("Erro ao obter histórico de ganhos:", error);
        res.status(500).json({ error: "Erro ao buscar histórico de ganhos." });
    }
}
