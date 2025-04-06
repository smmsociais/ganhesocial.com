import connectDB from "./db.js";
import { User } from "./User.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: "Token obrigatório." });
  }

  try {
    const usuario = await User.findOne({ token }).select("ganhosPorDia saldo");
    if (!usuario) {
      return res.status(403).json({ error: "Acesso negado." });
    }

    const ganhosMap = new Map();

    // Mapeia os ganhos usando o formato ISO "YYYY-MM-DD" para o fuso de Brasília
    for (const ganho of usuario.ganhosPorDia || []) {
      const dataStr = new Date(ganho.data).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      ganhosMap.set(dataStr, ganho.valor);
    }

    const historico = [];
    const hojeStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const hoje = new Date(hojeStr + "T00:00:00");

    for (let i = 0; i < 30; i++) {
      const data = new Date(hoje);
      data.setDate(data.getDate() - i);
      const dataStr = data.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      const valor = ganhosMap.get(dataStr) || 0;
      historico.push({ data: dataStr, valor });
    }

    historico.reverse(); // Do mais antigo para o mais recente

    res.status(200).json({ historico });
  } catch (error) {
    console.error("Erro ao obter histórico de ganhos:", error);
    res.status(500).json({ error: "Erro ao buscar histórico de ganhos." });
  }
}
