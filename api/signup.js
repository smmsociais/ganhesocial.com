import connectDB from "./db.js";
import { User } from "./User.js";
import crypto from "crypto";
import fetch from "node-fetch";

const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

const verifyRecaptcha = async (token) => {
    try {
        const response = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                secret: RECAPTCHA_SECRET_KEY,
                response: token
            })
        });

        const data = await response.json();
        return data.success; // Retorna true se o reCAPTCHA for válido
    } catch (error) {
        console.error("Erro ao verificar reCAPTCHA:", error);
        return false;
    }
};

const handler = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    const { nome_usuario, email, senha, recaptcha } = req.body;

    if (!nome_usuario || !email || !senha || !recaptcha) {
        return res.status(400).json({ error: "Todos os campos são obrigatórios, incluindo o reCAPTCHA." });
    }

    // Verificar reCAPTCHA antes de continuar
    const recaptchaValido = await verifyRecaptcha(recaptcha);
    if (!recaptchaValido) {
        return res.status(400).json({ error: "Falha na verificação do reCAPTCHA. Tente novamente." });
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
