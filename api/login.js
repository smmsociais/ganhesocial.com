import connectDB from "./db.js";
import { User } from "./User.js";
import jwt from "jsonwebtoken";

const handler = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    await connectDB();

    const { email, senha} = req.body;

    if (!email || !senha) {
        return res.status(400).json({ error: "E-mail e senha são obrigatórios!" });
    }

    try {
        // 🔍 Buscar usuário no banco
        const usuario = await User.findOne({ email });

        if (!usuario) {
            console.log("🔴 Usuário não encontrado!");
            return res.status(400).json({ error: "Usuário não encontrado!" });
        }

        if (senha !== usuario.senha) {
            console.log("🔴 Senha incorreta!");
            return res.status(400).json({ error: "Senha incorreta!" });
        }

        // 🔹 Gerar um novo token JWT válido
        const token = jwt.sign({ id: usuario._id }, process.env.JWT_SECRET, { algorithm: "HS256" });

        console.log("🟢 Novo token JWT gerado:", token);

        usuario.token = token;
        await usuario.save({ validateBeforeSave: false });

        res.json({ message: "Login bem-sucedido!", token });

    } catch (error) {
        console.error("❌ Erro ao realizar login:", error);
        res.status(500).json({ error: "Erro ao realizar login" });
    }
};

export default handler;
