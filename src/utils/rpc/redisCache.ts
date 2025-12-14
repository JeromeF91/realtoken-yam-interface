import Redis from 'ioredis';

// Redis client singleton
let redisClient: Redis | null = null;

/**
 * Get or create Redis client
 */
export const getRedisClient = (): Redis => {
  if (!redisClient) {
    // Support both REDIS_URL and direct host:port format
    const redisUrl = process.env.REDIS_URL || 
      (process.env.REDIS_HOST && process.env.REDIS_PORT 
        ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
        : 'redis://192.168.1.113:6379');
    redisClient = new Redis(redisUrl, {
      retryStrategy: (times) => {
        // Retry with exponential backoff, max 3 retries
        if (times > 3) {
          return null; // Stop retrying
        }
        return Math.min(times * 50, 2000);
      },
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false, // Don't queue commands when offline
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
      // Don't throw, just log - fallback to no cache
    });

    redisClient.on('connect', () => {
      console.log('Redis Client Connected');
    });
  }
  return redisClient;
};

/**
 * Get value from Redis cache
 */
export const getCache = async <T>(key: string): Promise<T | null> => {
  try {
    const client = getRedisClient();
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
 * Set value in Redis cache with TTL
 */
export const setCache = async (
  key: string,
  value: any,
  ttlSeconds: number = 300 // Default 5 minutes
): Promise<void> => {
  try {
    const client = getRedisClient();
    await client.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    console.error(`Redis setCache error for key ${key}:`, error);
    // Don't throw - just log, fallback to no cache
  }
};

/**
 * Get multiple values from Redis cache
 */
export const getMultipleCache = async <T>(keys: string[]): Promise<Map<string, T>> => {
  const result = new Map<string, T>();
  if (keys.length === 0) return result;

  try {
    const client = getRedisClient();
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
 * Set multiple values in Redis cache with TTL
 */
export const setMultipleCache = async (
  entries: Array<{ key: string; value: any }>,
  ttlSeconds: number = 300
): Promise<void> => {
  if (entries.length === 0) return;

  try {
    const client = getRedisClient();
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
 * Delete cache entry
 */
export const deleteCache = async (key: string): Promise<void> => {
  try {
    const client = getRedisClient();
    await client.del(key);
  } catch (error) {
    console.error(`Redis deleteCache error for key ${key}:`, error);
  }
};

/**
 * Check if Redis is available
 */
export const isRedisAvailable = async (): Promise<boolean> => {
  try {
    const client = getRedisClient();
    await client.ping();
    return true;
  } catch (error) {
    return false;
  }
};

