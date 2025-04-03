import connectDB from "./db.js";
import { User } from "./User.js";
import jwt from "jsonwebtoken";

const handler = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    await connectDB();

    const { email, senha} = req.body;

    if (!email || !senha) {
        return res.status(400).json({ error: "E-mail e senha são obrigatórios!" });
    }

        // 🔍 Buscando usuário no banco de dados...
        const usuario = await User.findOne({ email });

        if (!usuario) {
            console.log("🔴 Usuário não encontrado!");
            return res.status(400).json({ error: "Usuário não encontrado!" });
        }

        // 🔓 Comparação direta da senha (SEM HASH)
        if (senha !== usuario.senha) {
            console.log("🔴 Senha incorreta!");
            return res.status(400).json({ error: "Senha incorreta!" });
        }

        // 📌 Gerar/reutilizar token (SEM EXPIRAÇÃO)
        let token = usuario.token;
        if (!token) {
            token = jwt.sign({ id: usuario._id }, process.env.JWT_SECRET);
            usuario.token = token;
            await usuario.save({ validateBeforeSave: false });

            console.log("🟢 Novo token gerado e salvo.");
        } else {
            console.log("🟢 Token já existente mantido.");
        }
        
        console.log("🔹 Token gerado para usuário:", token);
        res.json({ message: "Login bem-sucedido!", token });

    } catch (error) {
        console.error("❌ Erro ao realizar login:", error);
        res.status(500).json({ error: "Erro ao realizar login" });
    }
};

export default handler;
