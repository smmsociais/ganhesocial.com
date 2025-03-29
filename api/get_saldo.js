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

        // Verificar se saldo é válido
        let saldo = usuario.saldo;

        if (typeof saldo !== "number" || isNaN(saldo)) {
            saldo = 0;  // Definir saldo como 0 se não for um número válido
        }

        res.status(200).json({ saldo: saldo.toFixed(2) });
    } catch (error) {
        console.error("Erro ao obter saldo:", error);
        res.status(500).json({ error: "Erro ao buscar saldo." });
    }
}
