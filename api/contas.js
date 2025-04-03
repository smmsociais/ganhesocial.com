import connectDB from "./db.js";
import jwt from "jsonwebtoken";
import { User } from "./User.js";
import dotenv from "dotenv";

dotenv.config();

export default async function handler(req, res) {
    try {
        await connectDB(); 

        if (req.method !== "POST" && req.method !== "GET") {
            return res.status(405).json({ error: "Método não permitido." });
        }

        let userData = null;

        // ✅ Tenta verificar o token, mas não bloqueia o acesso se for inválido
        const authHeader = req.headers.authorization;
        if (authHeader) {
            const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
            try {
                userData = jwt.verify(token, process.env.JWT_SECRET);
            } catch (error) {
                console.warn("⚠️ Token inválido ou malformado, ignorando autenticação.");
            }
        }

        if (req.method === "POST") {
            const { nomeConta, id_conta, id_tiktok, s } = req.body;

            if (!nomeConta || !id_conta) {
                return res.status(400).json({ error: "Nome da conta e id_conta são obrigatórios." });
            }

            // Se não houver usuário autenticado, não deixa cadastrar
            if (!userData) {
                return res.status(401).json({ error: "Autenticação necessária para adicionar conta." });
            }

            const user = await User.findById(userData.id);
            if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

            if (user.contas.some(conta => conta.nomeConta === nomeConta)) {
                return res.status(400).json({ error: "Já existe uma conta com este nome." });
            }

            user.contas.push({ nomeConta, id_conta, id_tiktok, s });
            await user.save();

            return res.status(201).json({ message: "Conta adicionada com sucesso!", id_conta });
        }

        if (req.method === "GET") {
            if (!userData) {
                return res.status(401).json({ error: "Autenticação necessária para listar contas." });
            }

            const user = await User.findById(userData.id);
            if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

            return res.json(user.contas);
        }

    } catch (error) {
        console.error("❌ Erro:", error);
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
}
