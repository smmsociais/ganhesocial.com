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
        const usuario = await User.findOne({ token }).select("saldo");
        if (!usuario) {
            return res.status(403).json({ error: "Acesso negado." });
        }

        let saldo = usuario.saldo;
        if (typeof saldo !== "number" || isNaN(saldo)) {
            saldo = 0;
        }

        // Distribuir saldo pelos últimos 30 dias corretamente
        const historico = [];
        const hoje = new Date();

        for (let i = 0; i < 30; i++) {
            const data = new Date();
            data.setDate(hoje.getDate() - i); // Garantir que o último dia seja correto
            const dataFormatada = data.toISOString().split("T")[0]; // YYYY-MM-DD

            // Exemplo de cálculo: distribuir uniformemente o saldo
            const ganhoDiario = (saldo / 30).toFixed(2);

            historico.push({ data: dataFormatada, valor: parseFloat(ganhoDiario) });
        }

        res.status(200).json({ historico });
    } catch (error) {
        console.error("Erro ao obter histórico de ganhos:", error);
        res.status(500).json({ error: "Erro ao buscar histórico de ganhos." });
    }
}
