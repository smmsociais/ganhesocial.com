import connectDB from "./db.js";
import { ActionHistory, User } from "./User.js";  // ajuste a importação se precisar

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  // 1) Extrai o token do header
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Token não fornecido." });
  }
  const token = authHeader.replace("Bearer ", "");

  // 2) Encontra o usuário a partir do token
  const usuario = await User.findOne({ token });
  if (!usuario) {
    return res.status(401).json({ error: "Token inválido." });
  }

  try {
    // 3) Busca só as ações daquele usuário
    const historico = await ActionHistory
      .find({ user: usuario._id })
      .sort({ data: -1 });

    const formattedData = historico.map(action => ({
      nome_usuario: action.nome_usuario,
      acao_validada: action.acao_validada,
      valor_confirmacao: action.valor_confirmacao,
      data: action.data,
      rede_social: action.rede_social || "TikTok",
      tipo: action.tipo_acao || "Seguir",
      url_dir: action.url_dir || null
    }));

    res.status(200).json(formattedData);
  } catch (error) {
    console.error("Erro ao buscar histórico de ações:", error);
    res.status(500).json({ error: "Erro ao buscar histórico de ações." });
  }
}
