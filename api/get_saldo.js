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
        // Selecione o saldo *e* a pix_key
        const usuario = await User.findOne({ token }).select("saldo pix_key");
        if (!usuario) {
            return res.status(403).json({ error: "Acesso negado." });
        }

        let saldo = usuario.saldo;
        if (typeof saldo !== "number" || isNaN(saldo)) {
            saldo = 0;
        }

        // Devolva pix_key exatamente como o front espera
        res.status(200).json({
            saldo,
            pix_key: usuario.pix_key  // <— o understore aqui é importante
        });
    } catch (error) {
        console.error("Erro ao obter saldo:", error);
        res.status(500).json({ error: "Erro ao buscar saldo." });
    }
}
