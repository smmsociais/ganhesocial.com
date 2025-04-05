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
        const usuario = await User.findOne({ token }).select("ganhosPorDia");
        if (!usuario) {
            return res.status(403).json({ error: "Acesso negado." });
        }

        const hoje = new Date();
        const dataHoje = hoje.toISOString().split("T")[0]; // YYYY-MM-DD

        const ganhoHoje = usuario.ganhosPorDia?.find(g => g.data === dataHoje)?.valor || 0;

        res.status(200).json({ data: dataHoje, valor: Number(ganhoHoje.toFixed(3)) });
    } catch (error) {
        console.error("Erro ao buscar ganho do dia:", error);
        res.status(500).json({ error: "Erro ao buscar ganho do dia." });
    }
}
