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
        console.log("Dados recebidos:", req.body);

        const user = await User.findOne({ token });
        if (!user) {
            return res.status(403).json({ error: "Token inválido." });
        }

        let { id_pedido, id_conta, url_dir, unique_id_verificado, acao_validada, data, quantidade_pontos, tipo_acao } = req.body;

        // Validação mínima
        if (quantidade_pontos === undefined || tipo_acao === undefined) {
            return res.status(400).json({ error: "Os campos quantidade_pontos e tipo_acao são obrigatórios.", recebido: req.body });
        }

        quantidade_pontos = Number(quantidade_pontos);
        if (isNaN(quantidade_pontos)) {
            return res.status(400).json({ error: "O campo quantidade_pontos deve ser um número válido." });
        }

        // Buscar nome do usuário da conta (nomeConta) com base no id_conta
let nome_usuario = req.body.nome_usuario || null;

if (!nome_usuario && id_conta) {
    const contaEncontrada = user.contas.find(conta => conta.id_conta === id_conta);
    if (contaEncontrada) {
        nome_usuario = contaEncontrada.nomeConta;
    }
}
        // Calcular valor de confirmação
        const valor_confirmacao = quantidade_pontos / 1000;

        // Criar nova ação
        const novaAcao = new ActionHistory({
            user: user._id,
            token: user.token,
            nome_usuario,
            quantidade_pontos,
            tipo_acao,
            valor_confirmacao,
            data: new Date(data || Date.now())
        });

        // Campos opcionais
        if (id_pedido) novaAcao.id_pedido = id_pedido;
        if (id_conta) novaAcao.id_conta = id_conta;
        if (url_dir) novaAcao.url_dir = url_dir;
        if (unique_id_verificado) novaAcao.unique_id_verificado = unique_id_verificado;
        if (acao_validada !== undefined) novaAcao.acao_validada = acao_validada;

        await novaAcao.save();

        res.status(200).json({ message: "Ação salva com sucesso." });
    } catch (error) {
        console.error("Erro ao salvar ação:", error);
        res.status(500).json({ error: "Erro ao salvar ação." });
    }
}
