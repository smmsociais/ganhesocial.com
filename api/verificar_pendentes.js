// pages/api/verificar_pendentes.js
import connectDB from "./db.js";
import { ActionHistory, User, VerificacaoGlobal } from "./User.js";
import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });

  await connectDB();

  const agora = new Date();

  // Verifica se já passou 1 minuto desde a última verificação global
  const doc = await VerificacaoGlobal.findById("verificacao_global");
  const podeVerificar = !doc || (agora - doc.ultimaVerificacao) > 60_000;

  if (!podeVerificar) {
    return res.status(200).json({ message: "A verificação foi feita recentemente." });
  }

  // Busca ações pendentes criadas há mais de 1 minuto
  const umMinutoAtras = new Date(agora.getTime() - 60_000);

  const pendentes = await ActionHistory.find({
    acao_validada: null,
    data: { $lte: umMinutoAtras }
  });

  for (const acao of pendentes) {
    const user = await User.findById(acao.user);
    if (!user) continue;

    const contaTikTok = user.contas.find(c => c.nomeConta === "tiktok");
    if (!contaTikTok) continue;

    try {
      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers.host;
      const baseUrl = `${protocol}://${host}`;

      const response = await axios.get(`${baseUrl}/api/user-following?userId=${contaTikTok.id_tiktok}`);
      const followingList = response.data.following || [];

      const estaSeguindo = followingList.includes(acao.id_conta);

      acao.acao_validada = estaSeguindo;
      acao.valor_confirmacao = estaSeguindo ? acao.quantidade_pontos * 0.001 : 0;
      await acao.save();
    } catch (err) {
      console.error("Erro na verificação automática:", err);
    }
  }

  // Atualiza/verifica controle global
  await VerificacaoGlobal.findByIdAndUpdate(
    "verificacao_global",
    { ultimaVerificacao: agora },
    { upsert: true }
  );

  res.status(200).json({ message: `Verificadas ${pendentes.length} ações pendentes.` });
}
