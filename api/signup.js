import connectDB from "./db.js";
import { User } from "./User.js";
import crypto from "crypto";

const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;

const verifyRecaptcha = async (token) => {
    try {
        const response = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                secret: RECAPTCHA_SECRET,
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
        // Verificar se nome de usuário ou e-mail já existem
        const usuarioExiste = await User.findOne({ nome_usuario });
        if (usuarioExiste) {
            return res.status(400).json({ error: "Nome de usuário já está em uso." });
        }

        const emailExiste = await User.findOne({ email });
        if (emailExiste) {
            return res.status(400).json({ error: "E-mail já está cadastrado." });
        }

        // Gerar um token único para o usuário
        const token = crypto.randomBytes(32).toString("hex");

        // Criar novo usuário com a senha em texto puro (⚠️ CUIDADO: não recomendado para produção)
        const novoUsuario = new User({ nome_usuario, email, senha, token });
        await novoUsuario.save();

        return res.status(201).json({ message: "Usuário registrado com sucesso!", token });
    } catch (error) {
        console.error("Erro ao cadastrar usuário:", error);
        return res.status(500).json({ error: "Erro interno ao registrar usuário. Tente novamente mais tarde." });
    }
};

export default handler;
