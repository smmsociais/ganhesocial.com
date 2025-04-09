import connectDB from "./db.js";
import { User } from "./User.js";
import dotenv from "dotenv";

dotenv.config();

export default async function handler(req, res) {
    try {
        await connectDB(); // Conectar ao banco antes de qualquer lógica

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: "Acesso negado, token não encontrado." });

        const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
        console.log("🔹 Token recebido:", token);

        if (!token) return res.status(401).json({ error: "Token inválido." });

        // ✅ Buscar usuário pelo token armazenado
        const user = await User.findOne({ token });
        if (!user) return res.status(404).json({ error: "Usuário não encontrado ou token inválido." });

        if (req.method === "POST") {
            // Criar conta
            const { nomeConta, id_conta, id_tiktok } = req.body;

            if (!nomeConta) {
                return res.status(400).json({ error: "Nome da conta é obrigatório." });
            }

            if (user.contas.some(conta => conta.nomeConta === nomeConta)) {
                return res.status(400).json({ error: "Já existe uma conta com este nome de usuário." });
            }

            user.contas.push({ nomeConta, id_conta, id_tiktok });
            await user.save();

            return res.status(201).json({ message: "Conta adicionada com sucesso!", nomeConta });
        }

        if (req.method === "GET") {
            // Listar contas do usuário
            return res.json(user.contas);
        }

if (req.method === "DELETE") {
    const { nomeConta } = req.query;
    if (!nomeConta) {
        return res.status(400).json({ error: "Nome da conta não fornecido." });
    }

    console.log("🔹 Nome da conta recebido para exclusão:", nomeConta);

    // Remover conta do array do usuário pelo nomeConta
    const contaIndex = user.contas.findIndex(conta => conta.nomeConta === nomeConta);

    if (contaIndex === -1) {
        return res.status(404).json({ error: "Conta não encontrada." });
    }

    user.contas.splice(contaIndex, 1);
    await user.save();

    return res.status(200).json({ message: `Conta ${nomeConta} desativada com sucesso.` });
}

        return res.status(405).json({ error: "Método não permitido." });

    } catch (error) {
        console.error("❌ Erro:", error);
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
}
