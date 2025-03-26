import mongoose from "mongoose";

let isConnected = false;

async function connectDB() {
  if (isConnected) return;

  try {
    const db = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000,
      bufferCommands: false,
    });

    isConnected = db.connections[0].readyState === 1;
    console.log("🔥 Conectado ao MongoDB!");
  } catch (error) {
    console.error("❌ Erro ao conectar ao MongoDB:", error);
    throw new Error("Erro ao conectar ao MongoDB");
  }
}

export default connectDB;  // Verifique se o export está correto!
