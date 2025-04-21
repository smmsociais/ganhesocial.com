import axios from "axios";
import connectDB from "./db.js";
import { User } from "./User.js";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    const { token, id_tiktok } = req.query;

    if (!token || !id_tiktok) {
        return res.status(400).json({ error: "Os parâmetros 'token' e 'id_tiktok' são obrigatórios." });
    }

    try {
        const usuario = await User.findOne({ token });

        if (!usuario) {
            return res.status(403).json({ error: "Acesso negado. Token inválido." });
        }

        const getActionUrl = `https://api.ganharnoinsta.com/get_action.php?token=a03f2bba-55a0-49c5-b4e1-28a6d1ae0876&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&id_conta=${id_tiktok}&is_tiktok=1&tipo=1`;
        const actionResponse = await axios.get(getActionUrl);
        const actionData = actionResponse.data;

        if (actionData.status === "CONTA_INEXISTENTE") {
            return res.status(200).json({
                status: "fail",
                id_tiktok,
                message: "conta_inexistente"
            });
        }

        if (actionData.status === "ENCONTRADA") {
            return res.status(200).json({
                status: "sucess",
                id_tiktok,
                url: actionData.url_dir,
                id_perfil: actionData.id_alvo,
                nome_usuario: actionData.nome_usuario,
                tipo_acao: actionData.tipo_acao,
                valor: actionData.quantidade_pontos
            });
        }

        return res.status(204).json({ message: "Nenhuma ação disponível no momento." });

    } catch (error) {
        console.error("Erro ao processar requisição:", error);
        return res.status(500).json({ error: "Erro interno ao processar requisição." });
    }
}
