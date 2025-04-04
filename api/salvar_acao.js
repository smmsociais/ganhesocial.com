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
        // Verificar se o token pertence a um usuário cadastrado
        const user = await User.findOne({ token });
        if (!user) {
            return res.status(403).json({ error: "Token inválido." });
        }

        const { nome_usuario, acao_validada, valor_confirmacao, data } = req.body;

        const novaAcao = new ActionHistory({
            user: user._id,
            token,
            nome_usuario,
            id_pedido: "",  // Adicione os valores corretos se necessários
            id_conta: "",  // Adicione os valores corretos se necessários
            url_dir: "",  // Adicione os valores corretos se necessários
            unique_id_verificado: "",  // Adicione os valores corretos se necessários
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
