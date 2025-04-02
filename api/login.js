import connectDB from "./db.js";
import { User } from "./User.js";
import jwt from "jsonwebtoken";

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  await connectDB();

  const { email, senha, recaptcha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ error: "E-mail e senha são obrigatórios!" });
  }

  if (!recaptcha) {
    return res.status(400).json({ error: "reCAPTCHA é obrigatório!" });
  }

  try {
    // 🔍 Verificando o reCAPTCHA com o Google
    const secretKey = process.env.RECAPTCHA_SECRET;
    const recaptchaResponse = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: secretKey, response: recaptcha })
    });

    const recaptchaData = await recaptchaResponse.json();

    if (!recaptchaData.success) {
      console.log("🔴 Falha na validação do reCAPTCHA!");
      return res.status(400).json({ error: "Falha na validação do reCAPTCHA!" });
    }

    console.log("🟢 reCAPTCHA validado com sucesso!");

    // 🔍 Buscando usuário no banco de dados...
    const usuario = await User.findOne({ email });

    if (!usuario) {
      console.log("🔴 Usuário não encontrado!");
      return res.status(400).json({ error: "Usuário não encontrado!" });
    }

    // Comparação direta da senha (SEM HASH)
    if (senha !== usuario.senha) {
      console.log("🔴 Senha incorreta!");
      return res.status(400).json({ error: "Senha incorreta!" });
    }

    // Se o usuário já tem um token salvo, reutiliza o mesmo
    let token = usuario.token;
    
    if (!token) {
      // Se não tiver token salvo, gera um novo e mantém no banco
      token = jwt.sign({ id: usuario._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
      usuario.token = token;
      await usuario.save({ validateBeforeSave: false });
      console.log("🟢 Novo token gerado e salvo.");
    } else {
      console.log("🟢 Token já existente mantido.");
    }

    res.json({ message: "Login bem-sucedido!", token });

  } catch (error) {
    console.error("❌ Erro ao realizar login:", error);
    res.status(500).json({ error: "Erro ao realizar login" });
  }
};

export default handler;
