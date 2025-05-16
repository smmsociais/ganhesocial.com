import connectDB from './db.js';
import { Action } from './Action.js';

const handler = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        await connectDB();

        const { tipo_acao, nome_usuario, quantidade_pontos, url_dir, id_pedido } = req.body;

        if (!tipo_acao || !nome_usuario || !quantidade_pontos || !url_dir || !id_pedido) {
            return res.status(400).json({ error: "Dados incompletos" });
        }

        // Verifica se ação já existe
        const jaExiste = await Action.findOne({ idPedido: id_pedido });
        if (jaExiste) {
            return res.status(409).json({ error: "Ação já cadastrada" });
        }

        // Cria nova ação
        const novaAcao = new Action({
            tipoAcao: tipo_acao,
            nomeUsuario: nome_usuario,
            pontos: quantidade_pontos,
            url: url_dir,
            idPedido: id_pedido,
            status: "pendente",
            dataCriacao: new Date()
        });

        await novaAcao.save();

        return res.status(201).json({ mensagem: "Ação adicionada com sucesso" });

    } catch (error) {
        console.error("Erro ao adicionar ação:", error);
        return res.status(500).json({ error: "Erro interno ao adicionar ação" });
    }
};

export default handler;
