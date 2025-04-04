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
        // Log dos dados recebidos para depuração
        console.log("Dados recebidos:", req.body);

// Encontrar o usuário pelo token
const user = await User.findOne({ token });
if (!user) {
    return res.status(403).json({ error: "Token inválido." });
}

        // Extrair os campos do corpo da requisição
        let { id_pedido, id_conta, url_dir, unique_id_verificado, acao_validada, valor_confirmacao, data, quantidade_pontos, tipo_acao } = req.body;

        // Garantir que `quantidade_pontos` seja um número
        if (quantidade_pontos) {
            quantidade_pontos = Number(quantidade_pontos);
            if (isNaN(quantidade_pontos)) {
                return res.status(400).json({ error: "O campo quantidade_pontos deve ser um número válido." });
            }
        }
        
// Validação mínima
if (quantidade_pontos === undefined || tipo_acao === undefined) {
    return res.status(400).json({ error: "Os campos quantidade_pontos e tipo_acao são obrigatórios.", recebido: req.body });
}

  // Buscar nome do usuário da conta (nomeConta) com base no id_conta
let nome_usuario = null;
if (id_conta) {
    const contaEncontrada = user.contas.find(conta => conta.id_conta === id_conta);
    if (contaEncontrada) {
        nome_usuario = contaEncontrada.nomeConta;
    }
}

// Validação do nome_usuario vindo do body
if (!req.body.nome_usuario) {
    return res.status(400).json({ error: "O campo nome_usuario (da conta TikTok) é obrigatório." });
}

// Criar objeto da ação com os campos mínimos
const novaAcao = new ActionHistory({
    user: user._id,
    token: user.token,
    nome_usuario: req.body.nome_usuario, // ✅ Agora corretamente vindo do body
    quantidade_pontos,
    tipo_acao,
    data: new Date(data || Date.now())
});

// Adicionar outros campos se presentes
if (id_pedido) novaAcao.id_pedido = id_pedido;
if (id_conta) novaAcao.id_conta = id_conta;
if (url_dir) novaAcao.url_dir = url_dir;
if (unique_id_verificado) novaAcao.unique_id_verificado = unique_id_verificado;
if (acao_validada !== undefined) novaAcao.acao_validada = acao_validada;
if (valor_confirmacao !== undefined) novaAcao.valor_confirmacao = valor_confirmacao;

await novaAcao.save();

        res.status(200).json({ message: "Ação salva com sucesso." });
    } catch (error) {
        console.error("Erro ao salvar ação:", error);
        res.status(500).json({ error: "Erro ao salvar ação." });
    }
}
