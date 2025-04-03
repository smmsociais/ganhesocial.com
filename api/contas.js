import connectDB from "./db.js";
import { User } from "./User.js";
import dotenv from "dotenv";

dotenv.config();

export default async function handler(req, res) {
    try {
        await connectDB(); // Conectar ao banco antes de qualquer lógica

        if (req.method !== "POST" && req.method !== "GET") {
            return res.status(405).json({ error: "Método não permitido." });
        }

        // ✅ Autenticação baseada no token armazenado no banco
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

            if (!nomeConta || !id_conta) {
                return res.status(400).json({ error: "Nome da conta e id_conta são obrigatórios." });
            }

            if (user.contas.some(conta => conta.nomeConta === nomeConta)) {
                return res.status(400).json({ error: "Já existe uma conta com este nome." });
            }

            user.contas.push({ nomeConta, id_conta, id_tiktok });
            await user.save();

            return res.status(201).json({ message: "Conta adicionada com sucesso!", id_conta });
        }

        if (req.method === "GET") {
            // Listar contas do usuário
            return res.json(user.contas);
        }

    } catch (error) {
        console.error("❌ Erro:", error);
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
}
