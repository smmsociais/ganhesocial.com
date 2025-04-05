import connectDB from "./db.js";
import { User } from "./User.js";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido. Use POST." });
    }

    await connectDB();

    const { token, novoSaldo } = req.body;

    if (!token || typeof novoSaldo !== "number") {
        return res.status(400).json({ error: "Token e novoSaldo são obrigatórios." });
    }

    try {
        const usuario = await User.findOne({ token });

        if (!usuario) {
            return res.status(403).json({ error: "Usuário não encontrado ou token inválido." });
        }

        const saldoAnterior = usuario.saldo || 0;
        const diferenca = parseFloat((novoSaldo - saldoAnterior).toFixed(3));

        // Atualiza o saldo
        usuario.saldo = novoSaldo;

        // Data atual no formato YYYY-MM-DD
        const hoje = new Date();
        const dataHoje = hoje.toISOString().split("T")[0];

        // Atualiza ou adiciona o valor de hoje em ganhosPorDia
        const ganhoExistente = usuario.ganhosPorDia?.find(g => g.data === dataHoje);

        if (ganhoExistente) {
            ganhoExistente.valor = parseFloat((ganhoExistente.valor + diferenca).toFixed(3));
        } else {
            usuario.ganhosPorDia.push({ data: dataHoje, valor: diferenca });
        }

        await usuario.save();

        res.status(200).json({
            mensagem: "Saldo e ganho diário atualizados com sucesso.",
            novoSaldo: usuario.saldo,
            ganhosPorDia: usuario.ganhosPorDia
        });

    } catch (error) {
        console.error("Erro ao atualizar saldo:", error);
        res.status(500).json({ error: "Erro interno ao atualizar saldo." });
    }
}
