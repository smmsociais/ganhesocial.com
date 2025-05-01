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

        // Buscar o usuário com o token
        const usuario = await User.findOne({ resetPasswordToken: token });

        if (!usuario) {
            console.log("❌ Token inválido ou usuário não encontrado!");
            return res.status(401).json({ error: "Token inválido" });
        }

        // (Opcional) Validar se o token expirou
        const expiracao = usuario.resetPasswordExpires ? new Date(usuario.resetPasswordExpires) : null;
        if (expiracao && expiracao < new Date()) {
            console.log("❌ Token expirado!");
            return res.status(401).json({ error: "Token expirado" });
        }

        const { novaSenha } = req.body;

        if (!novaSenha) {
            return res.status(400).json({ error: "Nova senha é obrigatória" });
        }

        // Alterar a senha
        usuario.senha = novaSenha;

        // Limpar o token após a redefinição da senha
usuario.resetPasswordToken = null;
usuario.resetPasswordExpires = null;

        await usuario.save();

        console.log("✅ Senha alterada com sucesso para o usuário:", usuario.email);
        return res.json({ message: "Senha alterada com sucesso!" });

    } catch (error) {
        console.error("❌ Erro ao alterar senha:", error);
        return res.status(500).json({ error: "Erro ao alterar senha" });
    }
};

export default handler;
