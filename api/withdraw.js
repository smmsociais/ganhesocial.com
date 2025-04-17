import { User } from './User';
import dbConnect from './db'; // Assumindo que você tem um utilitário de conexão com MongoDB

export default async function handler(req, res) {
    await dbConnect();

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Token ausente ou inválido" });
    }

    const token = authHeader.split(" ")[1];
    const user = await User.findOne({ token });

    if (!user) {
        return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { amount, payment_method, payment_data } = req.body;

    if (!amount || amount < 5 || payment_method !== "pix" || !payment_data?.pix_key) {
        return res.status(400).json({ error: "Dados inválidos para saque" });
    }

    const chavePix = payment_data.pix_key;
    const tipoChave = payment_data.pix_key_type || "cpf";

    if (!/^\d{11}$/.test(chavePix)) {
        return res.status(400).json({ error: "CPF inválido" });
    }

    // Verifica saldo
    if (user.saldo < amount) {
        return res.status(400).json({ error: "Saldo insuficiente" });
    }

    // Desconta saldo
    user.saldo -= amount;

    // Adiciona ao histórico de saques
    user.saques.push({
        valor: amount,
        chave_pix: chavePix,
        tipo_chave: tipoChave,
        status: "pendente" // pode ser atualizado depois
    });

    await user.save();

    return res.status(200).json({ message: "Saque solicitado com sucesso" });
}
