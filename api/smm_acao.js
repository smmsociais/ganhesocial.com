import connectDB from './db.js';
import { ActionHistory } from './User.js';

const handler = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        await connectDB();

        const { tipo_acao, nome_usuario, quantidade_pontos, url_dir, id_pedido } = req.body;

        // Validação dos campos recebidos
        if (!tipo_acao || !nome_usuario || !quantidade_pontos || !url_dir || !id_pedido) {
            return res.status(400).json({ error: "Dados incompletos" });
        }

        if (typeof quantidade_pontos !== "number" || quantidade_pontos <= 0) {
            return res.status(400).json({ error: "Quantidade de pontos inválida" });
        }

        // Verifica se a ação já existe
        const jaExiste = await ActionHistory.findOne({ id_pedido: id_pedido });
        if (jaExiste) {
            return res.status(409).json({ error: "Ação já cadastrada" });
        }

        // Cria nova ação no histórico
        const novaAcao = new ActionHistory({
            tipo_acao,
            nome_usuario,
            quantidade_pontos,
            url_dir,
            id_pedido,
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
