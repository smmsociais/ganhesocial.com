import connectDB from './db.js';
import { ActionHistory } from './User.js';

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    // Verificação da chave de API no cabeçalho
    const { authorization } = req.headers;
    if (!authorization || !authorization.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token não fornecido" });
    }

    const token = authorization.split(" ")[1];
    if (token !== process.env.SMM_API_KEY) {
      return res.status(401).json({ error: "Token inválido" });
    }

    await connectDB();

    const {
      tipo_acao,
      nome_usuario,
      quantidade_pontos,
      url_dir,
      id_pedido,
      quantidade,
      valor
    } = req.body;

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

    const jaExiste = await ActionHistory.findOne({ id_pedido: id_pedido });
    if (jaExiste) {
      return res.status(409).json({ error: "Ação já cadastrada" });
    }

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

    return res.status(201).json({ message: "Ação adicionada com sucesso" });

  } catch (error) {
    console.error("❌ Erro ao adicionar ação:", error);
    return res.status(500).json({ error: "Erro interno ao adicionar ação" });
  }
};

export default handler;
