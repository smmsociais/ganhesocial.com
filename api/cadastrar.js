import connectDB from "./db.js";
import User from "./User.js";
import crypto from "crypto";

const handler = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    const { nome_usuario, email, senha } = req.body;

    if (!nome_usuario || !email || !senha) {
        return res.status(400).json({ error: "Nome de usuário, e-mail e senha são obrigatórios." });
    }

    try {
        // Verificar se o e-mail ou nome de usuário já existem
        const userExists = await User.findOne({ $or: [{ nome_usuario }, { email }] });
        if (userExists) {
            return res.status(400).json({ error: "Usuário ou e-mail já registrado." });
        }

        // Gerar um token único para o usuário
        const token = crypto.randomBytes(32).toString("hex");

        // Criar novo usuário com o token
        const novoUsuario = new User({ nome_usuario, email, senha, token });
        await novoUsuario.save();

        return res.status(201).json({ message: "Usuário registrado com sucesso!", token });
    } catch (error) {
        console.error("Erro ao cadastrar usuário:", error);
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
};

export default handler;
