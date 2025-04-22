import Redis from 'ioredis';

let redis;

if (process.env.REDIS_URL) {
  if (!global.redis) {
    global.redis = new Redis(process.env.REDIS_URL);
  }
  
  redis = global.redis;
} else {
  throw new Error("REDIS_URL não configurada no ambiente");
}

export default redis;
