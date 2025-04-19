import connectDB from "./db.js";
import { ActionHistory, User } from "./User.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Token não fornecido." });
  }
  const token = authHeader.replace("Bearer ", "");

  const usuario = await User.findOne({ token });
  if (!usuario) {
    return res.status(401).json({ error: "Token inválido." });
  }

  try {
    const historico = await ActionHistory
      .find({ user: usuario._id })
      .sort({ data: -1 });

    const formattedData = historico.map(action => {
      let status;
      if (action.acao_validada === true) status = "Válida";
      else if (action.acao_validada === false) status = "Inválida";
      else status = "Pendente";

      return {
        nome_usuario: action.nome_usuario,
        acao_validada: action.acao_validada,
        valor_confirmacao: action.valor_confirmacao,
        data: action.data,
        rede_social: action.rede_social || "TikTok",
        tipo: action.tipo || "Seguir",
        url_dir: action.url_dir || null,
        status // 👈 novo campo adicionado
      };
    });

    res.status(200).json(formattedData);
  } catch (error) {
    console.error("Erro ao buscar histórico de ações:", error);
    res.status(500).json({ error: "Erro ao buscar histórico de ações." });
  }
}
