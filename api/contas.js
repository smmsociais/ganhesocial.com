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

        // 🔹 Verifica se o token foi enviado
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: "Acesso negado, token não encontrado." });
        }

        const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;

        let userData;
        try {
            userData = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            console.error("❌ Erro ao verificar token:", error);
            return res.status(401).json({ error: "Token inválido ou corrompido." });
        }

        // 🔹 Buscar usuário no MongoDB
        const user = await User.findOne({ _id: userData.id }).populate("historico_acoes");
        if (!user) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        if (req.method === "POST") {
            // 🔹 Criar nova conta
            const { nomeConta, id_conta, id_tiktok, s } = req.body;

            if (!nomeConta || !id_conta) {
                return res.status(400).json({ error: "Nome da conta e id_conta são obrigatórios." });
            }

            if (user.contas.some(conta => conta.nomeConta === nomeConta)) {
                return res.status(400).json({ error: "Já existe uma conta com este nome." });
            }

            user.contas.push({ nomeConta, id_conta, id_tiktok, s });
            await user.save();

            return res.status(201).json({ message: "Conta adicionada com sucesso!", id_conta });
        }

        if (req.method === "GET") {
            // 🔹 Retornar as contas do usuário
            return res.json({ contas: user.contas });
        }

    } catch (error) {
        console.error("❌ Erro:", error);
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
}
