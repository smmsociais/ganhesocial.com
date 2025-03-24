const { MongoClient } = require("mongodb");
const dotenv = require("dotenv");

// Carregar variáveis do .env
dotenv.config();

// Conectar ao MongoDB
async function connectDB() {
    const client = new MongoClient(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    
    try {
        await client.connect();
        console.log("Conectado ao MongoDB");

        const db = client.db("ganhesocial"); // Nome do banco de dados
        const contasCollection = db.collection("contas"); // Nome da coleção (equivalente à tabela)

        // Função para criar uma nova conta
        async function criarConta(userId, nomeConta, saldo = 0, historico = []) {
            const novaConta = {
                userId,
                nomeConta,
                saldo,
                historico,
            };

            // Inserir a nova conta na coleção "contas"
            const resultado = await contasCollection.insertOne(novaConta);
            console.log("Conta criada com sucesso:", resultado.ops[0]);
        }

        // Exemplo de inserção de uma nova conta
        await criarConta("123456789", "Conta Corrente", 1000);

        // Função para buscar todas as contas
        async function buscarContas() {
            const contas = await contasCollection.find().toArray();
            console.log("Contas encontradas:", contas);
        }

        await buscarContas();

    } catch (error) {
        console.error("Erro ao conectar ao MongoDB:", error);
    } finally {
        // Fechar a conexão
        await client.close();
    }
}

connectDB();

