import connectDB from "./db.js";
import { User } from "./User.js";

export default async function handler(req, res) {
    await connectDB();

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Token ausente ou inválido" });
    }

    const token = authHeader.split(" ")[1];
    const user = await User.findOne({ token });

    if (!user) {
        return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // ✅ Requisição GET - retorna histórico de saques
if (req.method === "GET") {
    const saquesFormatados = user.saques.map(saque => ({
        amount: saque.valor,
        pixKey: saque.chave_pix,
        keyType: saque.tipo_chave,
        status: saque.status,
        date: saque.data ? saque.data.toISOString() : new Date().toISOString()
    }));
    return res.status(200).json(saquesFormatados);
}

    // ✅ Requisição POST - novo saque
    if (req.method === "POST") {
        const { amount, payment_method, payment_data } = req.body;
    
        if (!amount || amount < 10 || payment_method !== "pix" || !payment_data?.pix_key) {
            return res.status(400).json({ error: "Dados inválidos" });
        }
    
        // Verifica se o usuário já tem uma chave PIX cadastrada
        if (!user.pix_key) {
            // Cadastra a chave PIX pela primeira vez
            user.pix_key = payment_data.pix_key;
            user.pix_key_type = payment_data.pix_key_type;
            await user.save();
        } else if (user.pix_key !== payment_data.pix_key) {
            // Impede alteração posterior
            return res.status(400).json({ error: "Chave PIX já cadastrada e não pode ser alterada." });
        }
    
        // Salvar o saque
        user.saques.push({
            valor: amount,
            chave_pix: user.pix_key,
            tipo_chave: user.pix_key_type,
            status: "pendente",
            data: new Date()
        });
    
        await user.save();
    
        return res.status(200).json({ message: "Saque solicitado com sucesso." });
    }    

    // ❌ Método não permitido
    return res.status(405).json({ error: "Método não permitido" });
}
