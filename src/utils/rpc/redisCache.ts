// Only import Redis on the server side using dynamic imports
// This prevents bundling Node.js modules for the client

// Redis client singleton
let Redis: any = null;
let redisClient: any = null;

/**
 * Check if we're on the server side
 */
const isServer = typeof window === 'undefined';

/**
 * Get or create Redis client (server-side only)
 */
export const getRedisClient = async (): Promise<any> => {
  // Only initialize Redis on the server
  if (!isServer) {
    return null;
  }

  if (!Redis) {
    try {
      // Dynamic import to prevent bundling for client
      Redis = (await import('ioredis')).default;
    } catch (error) {
      console.error('Failed to import ioredis:', error);
      return null;
    }
  }

  if (!redisClient) {
    try {
      const redisUrl = process.env.REDIS_URL || 
        (process.env.REDIS_HOST && process.env.REDIS_PORT 
          ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
          : 'redis://192.168.1.113:6379');
      redisClient = new Redis(redisUrl, {
        retryStrategy: (times: number) => {
          // Retry with exponential backoff, max 3 retries
          if (times > 3) {
            return null; // Stop retrying
          }
          return Math.min(times * 50, 2000);
        },
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false, // Don't queue commands when offline
      });

      redisClient.on('error', (err: Error) => {
        console.error('Redis Client Error:', err);
        // Don't throw, just log - fallback to no cache
      });

      redisClient.on('connect', () => {
        console.log('Redis Client Connected');
      });
    } catch (error) {
      console.error('Failed to create Redis client:', error);
      return null;
    }
  }
  return redisClient;
};

/**
 * Get value from Redis cache (server-side only)
 */
export const getCache = async <T>(key: string): Promise<T | null> => {
  if (!isServer) {
    return null;
  }

  try {
    const client = await getRedisClient();
    if (!client) return null;
    
    const value = await client.get(key);
    if (value) {
      return JSON.parse(value) as T;
    }
    return null;
  } catch (error) {
    console.error(`Redis getCache error for key ${key}:`, error);
    return null; // Fallback: return null if Redis fails
  }
};

/**
 * Set value in Redis cache with TTL (server-side only)
 */
export const setCache = async (
  key: string,
  value: any,
  ttlSeconds: number = 300 // Default 5 minutes
): Promise<void> => {
  if (!isServer) {
    return;
  }

  try {
    const client = await getRedisClient();
    if (!client) return;
    
    await client.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    console.error(`Redis setCache error for key ${key}:`, error);
    // Don't throw - just log, fallback to no cache
  }
};

/**
 * Get multiple values from Redis cache (server-side only)
 */
export const getMultipleCache = async <T>(keys: string[]): Promise<Map<string, T>> => {
  const result = new Map<string, T>();
  if (keys.length === 0 || !isServer) return result;

  try {
    const client = await getRedisClient();
    if (!client) return result;
    
    const values = await client.mget(...keys);
    
    values.forEach((value, index) => {
      if (value) {
        try {
          result.set(keys[index], JSON.parse(value) as T);
        } catch (error) {
          console.error(`Error parsing cached value for key ${keys[index]}:`, error);
        }
      }
    });
  } catch (error) {
    console.error('Redis getMultipleCache error:', error);
  }
  
  return result;
};

/**
 * Set multiple values in Redis cache with TTL (server-side only)
 */
export const setMultipleCache = async (
  entries: Array<{ key: string; value: any }>,
  ttlSeconds: number = 300
): Promise<void> => {
  if (entries.length === 0 || !isServer) return;

  try {
    const client = await getRedisClient();
    if (!client) return;
    
    const pipeline = client.pipeline();
    
    entries.forEach(({ key, value }) => {
      pipeline.setex(key, ttlSeconds, JSON.stringify(value));
    });
    
    await pipeline.exec();
  } catch (error) {
    console.error('Redis setMultipleCache error:', error);
  }
};

/**
 * Delete cache entry (server-side only)
 */
export const deleteCache = async (key: string): Promise<void> => {
  if (!isServer) return;

  try {
    const client = await getRedisClient();
    if (!client) return;
    
    await client.del(key);
  } catch (error) {
    console.error(`Redis deleteCache error for key ${key}:`, error);
  }
};

/**
 * Check if Redis is available (server-side only)
 */
export const isRedisAvailable = async (): Promise<boolean> => {
  if (!isServer) {
    return false;
  }

  try {
    const client = await getRedisClient();
    if (!client) return false;
    
    await client.ping();
    return true;
  } catch (error) {
    return false;
  }
};
