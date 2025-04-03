import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    throw new Error("❌ MONGODB_URI não foi definida no ambiente!");
}

let connection = null; // Variável global para armazenar a conexão

const connectDB = async () => {
    if (connection) {
        console.log("✅ Já conectado ao MongoDB!");
        return connection;
    }

    try {
        connection = await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            bufferCommands: false, // Evita armazenamento de comandos antes da conexão
        });

        console.log("🟢 Conectado ao MongoDB!");
        return connection;
    } catch (error) {
        console.error("❌ Erro ao conectar ao MongoDB:", error);
        throw new Error("Erro ao conectar ao banco de dados");
    }
};

export default connectDB;
