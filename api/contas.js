import connectDB from "./db.js";
import jwt from "jsonwebtoken";
import { User } from "./User.js";
import dotenv from "dotenv";

dotenv.config();

export default async function handler(req, res) {
    try {
        await connectDB(); // ✅ Aguarda a conexão antes de executar qualquer lógica

        if (req.method !== "POST" && req.method !== "GET") {
            return res.status(405).json({ error: "Método não permitido." });
        }

        // ✅ Autenticação
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: "Acesso negado, token não encontrado." });

        const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
        console.log("🔹 Token recebido no middleware:", token);

        if (!token) return res.status(401).json({ error: "Token inválido." });

        let userData;
        try {
            userData = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            console.error("❌ Erro ao verificar token:", error);
            return res.status(401).json({ error: "Token inválido ou corrompido." });
        }

        // ✅ Buscar usuário autenticado
        const user = await User.findById(userData.id);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

        if (req.method === "POST") {
            // Criar conta
            const { nomeConta, id_conta, id_tiktok, s } = req.body;

            if (!nomeConta || !id_conta) {
                return res.status(400).json({ error: "Nome da conta e id_conta são obrigatórios." });
            }

            if (user.contas.some(conta => conta.nomeConta === nomeConta)) {
                return res.status(400).json({ error: "Já existe uma conta com este nome." });
            }

            user.contas.push({ nomeConta, id_conta, id_tiktok, s, status: "Pendente" });
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
