import connectDB from "./db.js";
import { User } from "./User.js";

export default async function handler(req, res) {
    await connectDB();

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Token ausente ou inválido" });
    }

    const token = authHeader.split(" ")[1];
    const user = await User.findOne({ token });

    if (!user) {
        return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // ✅ Requisição GET - retorna histórico de saques
    if (req.method === "GET") {
        const saquesFormatados = user.saques.map(saque => ({
            amount: saque.valor,
            pixKey: saque.chave_pix,
            keyType: saque.tipo_chave,
            status: saque.status,
            date: saque.createdAt || saque.data || new Date() // fallback para o caso de ausência de data
        }));
        return res.status(200).json(saquesFormatados);
    }

    // ✅ Requisição POST - novo saque
    if (req.method === "POST") {
        const { amount, payment_method, payment_data } = req.body;

        if (!amount || amount < 5 || payment_method !== "pix" || !payment_data?.pix_key) {
            return res.status(400).json({ error: "Dados inválidos para saque" });
        }

        const chavePix = payment_data.pix_key;
        const tipoChave = payment_data.pix_key_type || "cpf";

        if (!/^\d{11}$/.test(chavePix)) {
            return res.status(400).json({ error: "CPF inválido" });
        }

        if (user.saldo < amount) {
            return res.status(400).json({ error: "Saldo insuficiente" });
        }

        user.saldo -= amount;

        user.saques.push({
            valor: amount,
            chave_pix: chavePix,
            tipo_chave: tipoChave,
            status: "pendente",
            createdAt: new Date()
        });

        await user.save();

        return res.status(200).json({ message: "Saque solicitado com sucesso" });
    }

    // ❌ Método não permitido
    return res.status(405).json({ error: "Método não permitido" });
}
