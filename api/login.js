import connectDB from "./db.js";
import User from "./User.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  await connectDB();

  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ error: "E-mail e senha são obrigatórios!" });
  }

  try {
    console.log("🔍 Buscando usuário no banco de dados...");
    const usuario = await User.findOne({ email }).select("+senha"); // Pegamos a senha, pois está oculta no esquema

    if (!usuario) {
      console.log("🔴 Usuário não encontrado!");
      return res.status(400).json({ error: "Usuário não encontrado!" });
    }

    // Comparar senha fornecida com a senha criptografada no banco
    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    if (!senhaValida) {
      console.log("🔴 Senha incorreta!");
      return res.status(400).json({ error: "Senha incorreta!" });
    }

    // Gerar um novo token JWT
    const novoToken = jwt.sign({ id: usuario._id }, process.env.JWT_SECRET, { expiresIn: "1h" });

    // (Opcional) Salvar o novo token no banco, caso queira manter sessões ativas
    usuario.token = novoToken;
    await usuario.save({ validateBeforeSave: false });

    res.json({ message: "Login bem-sucedido!", token: novoToken });

  } catch (error) {
    console.error("❌ Erro ao realizar login:", error);
    res.status(500).json({ error: "Erro ao realizar login" });
  }
};

export default handler;
