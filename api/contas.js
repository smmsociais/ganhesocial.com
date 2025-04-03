import connectDB from "./db.js";
import { User } from "./User.js";
import dotenv from "dotenv";

dotenv.config();

export default async function handler(req, res) {
    try {
        await connectDB(); // ✅ Aguarda a conexão antes de executar qualquer lógica

        if (req.method !== "POST" && req.method !== "GET") {
            return res.status(405).json({ error: "Método não permitido." });
        }

        if (req.method === "POST") {
            // Criar conta
            const { nomeConta, id_conta, id_tiktok, s } = req.body;

            if (!nomeConta || !id_conta) {
                return res.status(400).json({ error: "Nome da conta e id_conta são obrigatórios." });
            }

            // Criar um novo usuário genérico (⚠️ Perigoso, pois não há autenticação)
            let user = await User.findOne(); // Busca qualquer usuário existente
            if (!user) {
                user = new User({ contas: [] });
            }

            if (user.contas.some(conta => conta.nomeConta === nomeConta)) {
                return res.status(400).json({ error: "Já existe uma conta com este nome." });
            }

            user.contas.push({ nomeConta, id_conta, id_tiktok, s });
            await user.save();

            return res.status(201).json({ message: "Conta adicionada com sucesso!", id_conta });
        }

        if (req.method === "GET") {
            // Listar contas de qualquer usuário
            let user = await User.findOne(); 
            return res.json(user ? user.contas : []);
        }

    } catch (error) {
        console.error("❌ Erro:", error);
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
}
