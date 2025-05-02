import connectDB from "./db.js";
import { User } from "./User.js";
import jwt from "jsonwebtoken";

const handler = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        console.time("⏱️ Tempo total de login");
        await connectDB();
        console.timeLog("⏱️ Tempo total de login", "✔️ Conectado ao MongoDB");

        const { email, senha } = req.body;

        if (!email || !senha) {
            return res.status(400).json({ error: "E-mail e senha são obrigatórios!" });
        }

        console.log("🔍 Buscando usuário no banco de dados...");
        const usuario = await User.findOne({ email });
        console.timeLog("⏱️ Tempo total de login", "✔️ Usuário buscado");

        if (!usuario) {
            console.log("🔴 Usuário não encontrado!");
            return res.status(400).json({ error: "Usuário não encontrado!" });
        }

        if (senha !== usuario.senha) {
            console.log("🔴 Senha incorreta!");
            return res.status(400).json({ error: "Senha incorreta!" });
        }

        let token = usuario.token;
        if (!token) {
            token = jwt.sign({ id: usuario._id }, process.env.JWT_SECRET);
            usuario.token = token;
            await usuario.save({ validateBeforeSave: false });
            console.timeLog("⏱️ Tempo total de login", "✔️ Token gerado e salvo");

            console.log("🟢 Novo token gerado e salvo.");
        } else {
            console.log("🟢 Token já existente mantido.");
        }
        console.timeEnd("⏱️ Tempo total de login");

        console.log("🔹 Token gerado para usuário:", token);
        return res.json({ message: "Login bem-sucedido!", token });

    } catch (error) {
        console.error("❌ Erro ao realizar login:", error);
        return res.status(500).json({ error: "Erro ao realizar login" });
    }
    
};

export default handler;
