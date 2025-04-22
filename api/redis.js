import Redis from 'ioredis';

let redis;

if (process.env.REDIS_URL) {
  if (!global.redis) {
    global.redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 5,  // Limitar o número de tentativas
      connectTimeout: 10000,    // Timeout de conexão (10 segundos)
      retryStrategy: (times) => {
        // Controlar o intervalo entre as tentativas
        return Math.min(times * 50, 2000); // Aumentar exponencialmente até 2 segundos
      },
    });
  }
  
  redis = global.redis;
} else {
  throw new Error("REDIS_URL não configurada no ambiente");
}

export default redis;
