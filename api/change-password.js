import connectDB from "./db.js";
import { User } from "./User.js";
import jwt from "jsonwebtoken";

const handler = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        await connectDB();

        const { novaSenha } = req.body;
        const authHeader = req.headers.authorization;

        console.log("📩 Cabeçalho Authorization recebido:", authHeader);

        if (!novaSenha || novaSenha.length < 6) {
            console.log("❌ Nova senha inválida.");
            return res.status(400).json({ error: "A nova senha deve ter ao menos 6 caracteres" });
        }

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            console.log("❌ Token ausente ou malformado:", authHeader);
            return res.status(401).json({ error: "Token de autenticação ausente ou inválido" });
        }

        const token = authHeader.split(" ")[1];
        console.log("🔐 Token extraído:", token);

        // Verifica e decodifica o token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log("✅ Token decodificado:", decoded);

        const userId = decoded.id;

        const usuario = await User.findById(userId);
        if (!usuario) {
            console.log("❌ Usuário não encontrado para ID:", userId);
            return res.status(404).json({ error: "Usuário não encontrado" });
        }

        usuario.senha = novaSenha;
        await usuario.save();

        console.log("🟢 Senha alterada com sucesso para o usuário:", usuario.email);
        return res.status(200).json({ message: "Senha alterada com sucesso" });

    } catch (error) {
        console.error("❌ Erro ao alterar senha:", error);
        return res.status(500).json({ error: "Erro ao alterar senha" });
    }
};

export default handler;
