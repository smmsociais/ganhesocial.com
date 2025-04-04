import connectDB from "./db.js";
import { User } from "./User.js";
import crypto from "crypto";

const handler = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    const { nome, email, senha } = req.body;

    if (!nome || !email || !senha) {
        return res.status(400).json({ error: "Todos os campos são obrigatórios." });
    }

    try {
        // Verificar se nome de usuário ou e-mail já existem
        const usuarioExiste = await User.findOne({ nome });
        if (usuarioExiste) {
            return res.status(400).json({ error: "Nome de usuário já está em uso." });
        }

        const emailExiste = await User.findOne({ email });
        if (emailExiste) {
            return res.status(400).json({ error: "E-mail já está cadastrado." });
        }

        // Gerar token único
        const token = crypto.randomBytes(32).toString("hex");

        const novoUsuario = new User({ nome, email, senha, token });
        await novoUsuario.save();

        return res.status(201).json({ message: "Usuário registrado com sucesso!", token });
    } catch (error) {
        console.error("Erro ao cadastrar usuário:", error);
        return res.status(500).json({ error: "Erro interno ao registrar usuário. Tente novamente mais tarde." });
    }
};

export default handler;
