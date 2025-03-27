import connectDB from "./db.js";
import User from "./User.js";
import jwt from "jsonwebtoken"; 

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

    const usuario = await User.findOne({ email });
    
    // Verifique o valor retornado por "usuario"
    if (!usuario) {
      console.log("🔴 Usuário não encontrado!");
      return res.status(400).json({ error: "Usuário não encontrado!" });
    }

    // Comparar senha diretamente sem hashing
    if (senha !== usuario.senha) {
      console.log("🔴 Senha incorreta!");
      return res.status(400).json({ error: "Senha incorreta!" });
    }

    // Gerar o token JWT
    const token = jwt.sign(
      { id: usuario._id, email: usuario.email },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({ message: "Login bem-sucedido!", token });
  } catch (error) {
    console.error('❌ Erro ao realizar login:', error);
    res.status(500).json({ error: "Erro ao realizar login" });
  }
};

export default handler;
