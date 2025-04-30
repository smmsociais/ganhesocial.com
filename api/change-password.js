import connectDB from "./db.js";
import { User } from "./User.js";

const handler = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        await connectDB();
        console.log("Conectado ao MongoDB via Mongoose");

        const authHeader = req.headers.authorization || "";
        console.log("📩 Cabeçalho Authorization recebido:", authHeader);

        const token = authHeader.replace("Bearer ", "").trim();
        console.log("🔐 Token extraído:", token);

        if (!token) {
            return res.status(401).json({ error: "Token ausente" });
        }

        // Agora buscamos o usuário com esse token simples
        const usuario = await User.findOne({ token });

        if (!usuario) {
            console.log("❌ Token inválido ou usuário não encontrado!");
            return res.status(401).json({ error: "Token inválido" });
        }

        const { novaSenha } = req.body;

        if (!novaSenha) {
            return res.status(400).json({ error: "Nova senha é obrigatória" });
        }

        usuario.senha = novaSenha;
        await usuario.save();

        console.log("✅ Senha alterada com sucesso para o usuário:", usuario.email);
        return res.json({ message: "Senha alterada com sucesso!" });

    } catch (error) {
        console.error("❌ Erro ao alterar senha:", error);
        return res.status(500).json({ error: "Erro ao alterar senha" });
    }
};

export default handler;
