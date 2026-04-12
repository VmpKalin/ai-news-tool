import { Redis } from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  enableOfflineQueue: false,
});

redis.on('error', (err: Error) => {
  console.error(`[Redis] connection error: ${err.message}`);
});

redis.on('connect', () => {
  console.log(`[Redis] connecting to ${config.redisUrl}`);
});

redis.on('ready', () => {
  console.log('[Redis] ready');
});

export async function connectRedis(): Promise<void> {
  try {
    await redis.connect();
    const pong = await redis.ping();
    if (pong === 'PONG') {
      console.log('[Redis] connected');
    } else {
      console.warn(`[Redis] unexpected ping response: ${pong}`);
    }
  } catch (cause) {
    console.error('[Redis] initial connection failed — store operations will retry automatically', cause);
  }
}

export async function disconnectRedis(): Promise<void> {
  try {
    await redis.quit();
    console.log('[Redis] disconnected');
  } catch (cause) {
    console.error('[Redis] error during disconnect', cause);
  }
}
