import pkg from 'mongodb';
import crypto from 'crypto';

const { MongoClient } = pkg;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido.' });
    }

    const { nome_usuario, email, senha } = req.body;

    if (!nome_usuario || !email || !senha) {
        return res.status(400).json({ error: 'Nome de usuário, e-mail e senha são obrigatórios.' });
    }

    try {
        console.log('🔹 Conectando ao MongoDB...');
        const client = await MongoClient.connect(process.env.MONGO_URI);
        console.log('✅ Conectado com sucesso!');

        const db = client.db('ganhesocial');

        // Verificar se o e-mail ou nome de usuário já existem
        const userExists = await db.collection('usuarios').findOne({ $or: [{ nome_usuario }, { email }] });
        if (userExists) {
            client.close();
            return res.status(400).json({ error: 'Usuário ou e-mail já registrado.' });
        }

        // Gerar um token único para o usuário
        const token = crypto.randomBytes(32).toString('hex');

        // Criar novo usuário com o nome, e-mail, senha e token
        const resultado = await db.collection('usuarios').insertOne({
            nome_usuario,
            email, // Adicionando o email ao banco
            senha, // ⚠️ Senha deve ser criptografada com bcrypt
            token
        });

        console.log('✅ Usuário cadastrado:', resultado.insertedId);

        client.close();
        return res.status(201).json({ message: 'Usuário registrado com sucesso!', token });

    } catch (error) {
        console.error('❌ Erro ao conectar/inserir no MongoDB:', error);
        return res.status(500).json({ error: 'Erro interno no servidor' });
    }
}
