import pkg from 'mongodb';
import crypto from "crypto";

const { MongoClient } = pkg;

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    const { nomeUsuario, senha } = req.body; // 🔹 Corrigido: agora corresponde ao frontend

    if (!nomeUsuario || !senha) {
        return res.status(400).json({ error: "Nome de usuário e senha são obrigatórios." });
    }

    // Conectar ao banco de dados
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db("ganhesocial");

    // Verificar se o usuário já existe
    const userExists = await db.collection("usuarios").findOne({ nomeUsuario });
    if (userExists) {
        client.close();
        return res.status(400).json({ error: "Usuário já registrado." });
    }

    // Gerar um token único para o usuário
    const token = crypto.randomBytes(32).toString("hex");

    // Criar novo usuário com o token
    await db.collection("usuarios").insertOne({
        nomeUsuario, // 🔹 Corrigido: agora corresponde ao frontend
        senha, // 🔹 (Ideal criptografar com bcrypt)
        token
    });

    client.close();

    res.status(201).json({ message: "Usuário registrado com sucesso!", token });
}
