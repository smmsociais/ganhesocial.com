import connectDB from "./db.js";
import jwt from "jsonwebtoken";
import { User } from "./User.js";
import dotenv from "dotenv";

dotenv.config();

// Conectar ao banco de dados
connectDB();

// Middleware de autenticação
const authMiddleware = (req) => {
    const token = req.headers.authorization?.split(" ")[1] || req.headers.authorization;
    if (!token) throw new Error("Acesso negado, token não encontrado.");

    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        throw new Error("Token inválido.");
    }
};

// Handler principal da API
export default async function handler(req, res) {
    try {
        if (req.method === "POST") {
            // Criar conta
            const { nomeConta, id_conta, id_tiktok, s } = req.body;
            const userData = authMiddleware(req);

            if (!nomeConta || !id_conta) {
                return res.status(400).json({ error: "Nome da conta e id_conta são obrigatórios." });
            }

            const user = await User.findById(userData.id);
            if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

            if (user.contas.some(conta => conta.nomeConta === nomeConta)) {
                return res.status(400).json({ error: "Já existe uma conta com este nome." });
            }

            user.contas.push({ nomeConta, id_conta, id_tiktok, s, status: "Pendente" });
            await user.save();

            return res.status(201).json({ message: "Conta adicionada com sucesso!", id_conta });
        }

        if (req.method === "GET") {
            // Listar contas do usuário
            const userData = authMiddleware(req);
            const user = await User.findById(userData.id);
            if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

            return res.json(user.contas);
        }

        res.status(405).json({ error: "Método não permitido." });
    } catch (error) {
        console.error("Erro:", error);
        return res.status(500).json({ error: error.message || "Erro interno no servidor." });
    }
}
