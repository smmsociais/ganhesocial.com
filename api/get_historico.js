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

    // Cria um mapa para agrupar os ganhos por data (formato YYYY-MM-DD)
    const ganhosMap = new Map();

    // Processa cada entrada de ganhosPorDia
    for (const ganho of usuario.ganhosPorDia || []) {
      // Converte a data armazenada (UTC) para o fuso de Brasília
      const dataBrasilia = new Date(ganho.data).toLocaleDateString("en-CA", {
        timeZone: "America/Sao_Paulo"
      });
      
      // Soma os valores quando há múltiplas entradas no mesmo dia
      const valorAtual = ganhosMap.get(dataBrasilia) || 0;
      ganhosMap.set(dataBrasilia, valorAtual + ganho.valor);
    }

    // Calcula a data atual em Brasília (início do dia)
    const now = new Date();
    const optionsTime = {
      timeZone: "America/Sao_Paulo",
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    };
    
    const timeInBrasilia = now.toLocaleTimeString("en-US", optionsTime);
    const [hours, minutes, seconds] = timeInBrasilia.split(':').map(Number);
    const msSinceMidnight = (hours * 3600 + minutes * 60 + seconds) * 1000;
    const hoje = new Date(now.getTime() - msSinceMidnight);

    // Gera o histórico dos últimos 30 dias
    const historico = [];
    for (let i = 0; i < 30; i++) {
      const data = new Date(hoje);
      data.setDate(data.getDate() - i);
      
      // Formata a data para o padrão YYYY-MM-DD
      const dataFormatada = data.toLocaleDateString("en-CA", {
        timeZone: "America/Sao_Paulo"
      });
      
      // Obtém o valor do mapa ou zero se não existir
      const valor = ganhosMap.get(dataFormatada) || 0;
      
      // Formata a data para exibição (DD/MM/YYYY)
      const dataExibicao = data.toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo"
      });

      // Adiciona "Hoje" para a data atual
      const label = i === 0 ? "Hoje" : dataExibicao;

      historico.push({
        data: label,
        valor: parseFloat(valor.toFixed(3)) // Garante 3 casas decimais
      });
    }

    // Ordena do mais recente para o mais antigo
    historico.reverse();

    res.status(200).json({
      saldo: usuario.saldo,
      historico,
      ultimaAtualizacao: new Date().toISOString()
    });

  } catch (error) {
    console.error("Erro ao obter histórico de ganhos:", error);
    res.status(500).json({
      error: "Erro ao buscar histórico de ganhos.",
      detalhes: error.message
    });
  }
}
