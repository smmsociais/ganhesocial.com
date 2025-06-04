// api/db.js
import mongoose from "mongoose";

const URI = process.env.MONGODB_URI;
if (!URI) throw new Error("MONGODB_URI não definida!");

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

export default async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(URI, {
      bufferCommands: false, // ⛔ evita empilhamento de comandos em conexão lenta
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  }

  try {
    cached.conn = await cached.promise;
    console.log("🟢 Conectado ao MongoDB via Mongoose");
  } catch (err) {
    cached.promise = null; // ⚠️ evita travamento em futuras chamadas
    throw err;
  }

  return cached.conn;
}
