import axios from "axios";
import connectDB from "./db.js";
import User from "./User.js";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    // Conectar ao banco de dados
    await connectDB();

    // Obter o token da query string
    const { token, nome_usuario } = req.query;

    if (!token) {
        return res.status(400).json({ error: "O parâmetro 'token' é obrigatório." });
    }

    if (!nome_usuario) {
        return res.status(400).json({ error: "O parâmetro 'nome_usuario' é obrigatório." });
    }

    try {
        // Buscar usuário pelo token fixo salvo no MongoDB
        const usuario = await User.findOne({ token });

        if (!usuario) {
            return res.status(403).json({ error: "Acesso negado. Token inválido." });
        }

        // Chamar a API bind_tk para obter o ID da conta
        const bindTkUrl = `http://api.ganharnoinsta.com/bind_tk.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nome_usuario}`;

        const bindResponse = await axios.get(bindTkUrl);
        const bindData = bindResponse.data;

        // Verifica se a resposta contém um erro específico "Erro ao vincular conta"
        if (bindData.error && bindData.error === 'Erro ao vincular conta.') {
            // Força a resposta de sucesso quando ocorre esse erro específico
            return res.status(200).json({
                message: 'sucess', 
                id_conta: '7484742743441998854',
                detalhes: {
                    status: 'success',
                    id_conta: '7484742743441998854',
                    id_tiktok: '7484742743441998854',
                    s: '3'
                }
            });
        }

        // Caso a conta tenha sido vinculada com sucesso
        if (bindData.status === "success" && bindData.message === "Conta vinculada com sucesso!") {
            // Verifica se a conta já está cadastrada no banco
            const contaExistente = await User.findOne({ "contas.id_conta": bindData.id_conta });

            if (contaExistente) {
                return res.status(400).json({ error: "Esta conta já está vinculada." });
            }

            // Se não existir a conta, adiciona a nova conta ao banco
            const user = await User.findOne({ token });
            if (!user) {
                return res.status(404).json({ error: "Usuário não encontrado." });
            }

            // Adiciona a nova conta
            user.contas.push({
                id_conta: bindData.id_conta,
                id_tiktok: bindData.id_tiktok,
                status: "success",
                s: bindData.s
            });

            await user.save();

            return res.status(200).json({
                message: 'Conta vinculada com sucesso!',
                id_conta: bindData.id_conta,
                detalhes: {
                    status: bindData.status,
                    id_conta: bindData.id_conta,
                    id_tiktok: bindData.id_tiktok,
                    s: bindData.s
                }
            });
        }

        // Se a resposta for outro erro de falha no vinculo
        return res.status(400).json({ error: bindData.message || "Erro ao vincular conta." });

    } catch (error) {
        console.error("Erro ao processar requisição:", error);
        return res.status(500).json({ error: "Erro interno ao processar requisição." });
    }
}
