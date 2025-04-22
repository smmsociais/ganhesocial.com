import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379'); // ajuste se estiver usando Vercel

export default redis;
