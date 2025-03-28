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

        // Verifique se a conta já está vinculada no banco de dados
        const contaExistente = usuario.contas.find(conta => conta.id_conta === bindData.id_conta);
        console.log("Verificando conta existente:", contaExistente);

        if (contaExistente) {
            return res.status(400).json({ error: "Esta conta já está vinculada." });
        }

        // Verifique a resposta da plataforma
        if (bindData.status === "success" && bindData.message === "Conta vinculada com sucesso!") {
            // Se a conta foi vinculada com sucesso, não a adicione ao banco
            return res.status(200).json({
                message: "Conta já vinculada com sucesso à plataforma!",
                id_conta: bindData.id_conta,
                detalhes: bindData.detalles
            });
        }

        // Se a resposta indicar sucesso ou falha, continue
        if (bindData.status === "success" || bindData.status === "fail") {
            // Adicionar a conta ao usuário se não foi vinculada com sucesso
            usuario.contas.push({
                nomeConta: nome_usuario,
                status: bindData.status === "fail" ? "Pendente" : "Aprovada", // Se falhar, marca como pendente
                id_conta: bindData.id_conta,
                id_tiktok: bindData.id_tiktok || bindData.id_conta,
                s: bindData.s || "3"
            });

            // Salvar as mudanças no banco de dados
            await usuario.save({ validateBeforeSave: false });

            return res.status(200).json({
                message: bindData.status === "fail" 
                    ? "Conta vinculada com falha, mas registrada como pendente." 
                    : "Conta vinculada com sucesso!",
                id_conta: bindData.id_conta,
                detalhes: {
                    status: bindData.status,
                    id_conta: bindData.id_conta,
                    id_tiktok: bindData.id_tiktok || bindData.id_conta,
                    s: bindData.s || "3"
                }
            });
        }

        return res.status(400).json({ error: "Erro ao vincular conta." });

    } catch (error) {
        console.error("Erro ao processar requisição:", error);
        return res.status(500).json({ error: "Erro interno ao processar requisição." });
    }
}
