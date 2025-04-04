import connectDB from "./db.js";
import { ActionHistory, User } from "./User.js";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Token ausente." });

    try {
        // Encontrar o usuário pelo token
        const user = await User.findOne({ token });
        if (!user) {
            return res.status(403).json({ error: "Token inválido." });
        }

        // Extrair os campos do corpo da requisição
        const { id_pedido, id_conta, url_dir, unique_id_verificado, acao_validada, valor_confirmacao, data } = req.body;

        // Verificar se todos os campos obrigatórios estão presentes
        if (!id_pedido || !id_conta || !url_dir || !unique_id_verificado) {
            return res.status(400).json({ error: "Campos obrigatórios ausentes." });
        }

        // Criar nova ação
        const novaAcao = new ActionHistory({
            user: user._id,
            token: user.token,
            nome_usuario: user.nome_usuario,
            id_pedido,
            id_conta,
            url_dir,
            unique_id_verificado,
            acao_validada,
            valor_confirmacao,
            data: new Date(data)
        });

        await novaAcao.save();

        res.status(200).json({ message: "Ação salva com sucesso." });
    } catch (error) {
        console.error("Erro ao salvar ação:", error);
        res.status(500).json({ error: "Erro ao salvar ação." });
    }
}
