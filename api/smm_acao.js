import connectDB from './db.js';
import { ActionHistory } from './User.js';

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    // 🔐 Validação do token de API
    const { authorization } = req.headers;
    const token = authorization?.split(" ")[1];

    if (!token || token !== process.env.SMM_API_KEY) {
      return res.status(401).json({ error: "Não autorizado" });
    }

    await connectDB();

    // 📦 Extração de dados
    const {
      tipo_acao,
      nome_usuario,
      quantidade_pontos,
      url_dir,
      id_pedido,
      quantidade,
      valor
    } = req.body;

    // 📌 Verificação de campos obrigatórios
    if (
      !tipo_acao ||
      !nome_usuario ||
      quantidade_pontos === undefined ||
      !url_dir ||
      !id_pedido ||
      quantidade === undefined ||
      valor === undefined
    ) {
      return res.status(400).json({ error: "Dados incompletos" });
    }

    // 🧮 Conversões e validações numéricas
    const pontos = parseFloat(quantidade_pontos);
    const qtd = parseInt(quantidade);
    const val = parseFloat(valor);

    if (isNaN(pontos) || pontos <= 0) {
      return res.status(400).json({ error: "Quantidade de pontos inválida" });
    }
    if (isNaN(qtd) || qtd <= 0) {
      return res.status(400).json({ error: "Quantidade inválida" });
    }
    if (isNaN(val) || val <= 0) {
      return res.status(400).json({ error: "Valor inválido" });
    }

    // 🔎 Verificar se ação já foi cadastrada
    const jaExiste = await ActionHistory.findOne({ id_pedido });
    if (jaExiste) {
      return res.status(409).json({ error: "Ação já cadastrada" });
    }

    // 📝 Registro da nova ação
    const novaAcao = new ActionHistory({
      tipo_acao,
      nome_usuario,
      quantidade_pontos: pontos,
      url_dir,
      id_pedido,
      quantidade: qtd,
      valor: val,
      status: "pendente",
      acao_validada: null,
      valor_confirmacao: 0
    });

    await novaAcao.save();

    console.log("✅ Nova ação registrada:", {
      tipo_acao,
      nome_usuario,
      id_pedido,
      pontos
    });

    return res.status(201).json({ message: "Ação adicionada com sucesso" });

  } catch (error) {
    console.error("❌ Erro ao adicionar ação:", error);
    return res.status(500).json({ error: "Erro interno ao adicionar ação" });
  }
};

export default handler;
