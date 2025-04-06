import connectDB from "./db.js";
import { User } from "./User.js";

// Função para converter qualquer Date em "YYYY-MM-DD" no fuso de Brasília
function formatarDataBrasilia(dateInput) {
  const dataBR = new Date(dateInput.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return dataBR.toISOString().slice(0, 10); // Retorna 'YYYY-MM-DD'
}

// Retorna o Date correspondente à meia-noite de hoje no fuso de Brasília
function getBrasiliaMidnightDate() {
  const now = new Date();
  const brTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  brTime.setHours(0, 0, 0, 0);
  return brTime;
}

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

    for (const ganho of usuario.ganhosPorDia || []) {
      const dataStr = formatarDataBrasilia(new Date(ganho.data));
      ganhosMap.set(dataStr, ganho.valor);
    }

    const historico = [];
    const hoje = getBrasiliaMidnightDate();

    for (let i = 0; i < 30; i++) {
      const data = new Date(hoje);
      data.setDate(data.getDate() - i);

      const dataFormatada = formatarDataBrasilia(data);
      const valor = ganhosMap.get(dataFormatada) || 0;

      historico.push({ data: dataFormatada, valor });
    }

    historico.reverse(); // Do mais antigo para o mais recente

    res.status(200).json({ historico });
  } catch (error) {
    console.error("Erro ao obter histórico de ganhos:", error);
    res.status(500).json({ error: "Erro ao buscar histórico de ganhos." });
  }
}
