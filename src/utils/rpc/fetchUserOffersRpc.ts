import { JsonRpcProvider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import { utils } from 'ethers';
import BigNumber from 'bignumber.js';
import { CHAINS, ChainsID } from '../../constants';
import { realTokenYamUpgradeableABI, erc20ABI } from '../../abis';
import { RealTokenYamUpgradeable } from '../../abis/types/RealTokenYamUpgradeable';
import { getRpcProvider, getTokenInfo } from './rpcHelpers';
import { Offer } from '../../types/offer/Offer';
import { PropertiesToken } from '../../types';
import { Price } from '../../types/price';
import { DataRealtokenType } from '../../types/offer/DataRealtokenType';
import { parseOffer } from '../offers/parseOffer';
import { getExtendedTokens } from '../../constants/GetPriceToken';
import { batchShowOffers } from './multicall';

/**
 * Conditionally import Redis cache functions (server-side only)
 * This prevents Next.js from bundling ioredis for the client
 */
const getRedisCacheFunctions = async () => {
  if (typeof window !== 'undefined') {
    // Client-side: return no-op functions
    return {
      getCache: async () => null,
      setCache: async () => {},
      getMultipleCache: async () => new Map(),
      setMultipleCache: async () => {},
      isRedisAvailable: async () => false,
    };
  }
  
  // Server-side: dynamically import Redis cache
  try {
    return await import('./redisCache');
  } catch (error) {
    console.error('Failed to load Redis cache:', error);
    return {
      getCache: async () => null,
      setCache: async () => {},
      getMultipleCache: async () => new Map(),
      setMultipleCache: async () => {},
      isRedisAvailable: async () => false,
    };
  }
};

/**
 * Delay function for rate limiting
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Cache key prefixes
 */
const CACHE_PREFIX = {
  TOKEN_INFO: 'token:info:',
  TOKEN_DECIMALS: 'token:decimals:',
  ACCOUNT_BALANCE: 'account:balance:',
};

/**
 * Cache TTL in seconds
 */
const CACHE_TTL = {
  TOKEN_INFO: 3600, // 1 hour
  TOKEN_DECIMALS: 3600, // 1 hour
  ACCOUNT_BALANCE: 60, // 1 minute
};

/**
 * Fetch only user's own offers using RPC calls
 * This is optimized to only fetch offers where the user is the seller
 */
export const fetchUserOffersRpc = async (
  account: string,
  chainId: number,
  propertiesToken: PropertiesToken[],
  wlProperties: number[],
  prices: Price
): Promise<Offer[]> => {
  try {
    const provider = getRpcProvider(chainId);
    const chainConfig = CHAINS[chainId as ChainsID];
    const { address: yamContractAddress } = chainConfig.contracts.realTokenYamUpgradeable;

    // Get YAM contract instance
    const yamContract = new Contract(
      yamContractAddress,
      realTokenYamUpgradeableABI,
      provider
    ) as RealTokenYamUpgradeable;

    // Get total offer count
    const offerCountBN = await yamContract.getOfferCount();
    const offerCount = offerCountBN.toNumber();
    console.log('Total offers on chain:', offerCount);

    if (offerCount === 0) {
      return [];
    }

    // Load Redis cache functions (server-side only)
    const redisCache = await getRedisCacheFunctions();
    const useRedis = await redisCache.isRedisAvailable();
    console.log(`Using Redis cache: ${useRedis}`);

    // In-memory caches as fallback
    const tokenInfoCache = new Map<string, { tokenType: number; name: string; symbol: string }>();
    const tokenDecimalsCache = new Map<string, number>();
    const accountRealtokenMap = new Map<string, DataRealtokenType>();

    // Fetch offers using multicall (batched RPC calls)
    const userOffers: Offer[] = [];
    const offerDataArray: Array<{
      offerId: number;
      seller: string;
      offerTokenAddress: string;
      buyerTokenAddress: string;
      buyer: string;
      price: string;
      amount: string;
    }> = [];

    // Step 1: Fetch all offers using multicall (single RPC call!)
    const userAddressLower = account.toLowerCase();
    const contractInterface = new utils.Interface(realTokenYamUpgradeableABI);
    
    // Prepare all offer IDs
    const allOfferIds = Array.from({ length: offerCount }, (_, i) => i);
    
    // Use multicall to fetch all offers in a single RPC call
    // Split into chunks if too many (multicall has limits, typically 100-200 calls)
    const multicallBatchSize = 100; // Safe limit for most RPC providers
    const offerResults: Array<{ offerId: number; success: boolean; data: any }> = [];
    
    // Ensure provider is ready before making calls
    try {
      await provider.getNetwork();
    } catch (networkError: any) {
      console.error('Provider network error:', networkError);
      // If network detection fails, the provider should still work with explicit network config
      // But log the error for debugging
      if (networkError?.code === 'NETWORK_ERROR') {
        console.warn('Network detection failed, but continuing with explicit network configuration');
      }
    }
    
    for (let i = 0; i < allOfferIds.length; i += multicallBatchSize) {
      const batchIds = allOfferIds.slice(i, i + multicallBatchSize);
      
      try {
        const batchResults = await batchShowOffers(
          provider,
          yamContractAddress,
          contractInterface,
          batchIds
        );
        
        // Map results back to offer IDs
        batchResults.forEach((result, index) => {
          offerResults.push({
            offerId: batchIds[index],
            success: result.success,
            data: result.data,
          });
        });
      } catch (error: any) {
        // Handle network errors gracefully
        if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('could not detect network')) {
          console.error(`Network error fetching offers batch ${i}-${i + batchIds.length}:`, error?.message);
          // Mark all offers in this batch as failed
          batchIds.forEach(offerId => {
            offerResults.push({
              offerId,
              success: false,
              data: null,
            });
          });
        } else {
          console.error(`Error fetching offers batch ${i}-${i + batchIds.length}:`, error);
          // Mark all offers in this batch as failed
          batchIds.forEach(offerId => {
            offerResults.push({
              offerId,
              success: false,
              data: null,
            });
          });
        }
      }
      
      // Small delay between multicall batches if needed
      if (i + multicallBatchSize < allOfferIds.length) {
        await delay(50);
      }
    }
    
    // Filter for user's offers and extract data
    offerResults.forEach(({ offerId, success, data }) => {
      if (!success || !data) {
        // Skip failed calls (offers that don't exist)
        return;
      }
      
      try {
        const [seller, offerTokenAddress, buyerTokenAddress, buyer, priceBN, amountBN] = data;
        
        // Only process if this is the user's offer
        if (seller.toLowerCase() === userAddressLower) {
          offerDataArray.push({
            offerId,
            seller: seller.toLowerCase(),
            offerTokenAddress: offerTokenAddress.toLowerCase(),
            buyerTokenAddress: buyerTokenAddress.toLowerCase(),
            buyer: buyer.toLowerCase(),
            price: priceBN.toString(),
            amount: amountBN.toString(),
          });
        }
      } catch (error) {
        // Skip invalid data
        console.warn(`Error processing offer ${offerId}:`, error);
      }
    });

    console.log(`Found ${offerDataArray.length} offers for user ${account}`);

    if (offerDataArray.length === 0) {
      return [];
    }

    // Step 2: Collect unique tokens and fetch token info
    const uniqueTokens = new Set<string>();
    offerDataArray.forEach(offer => {
      uniqueTokens.add(offer.offerTokenAddress);
      uniqueTokens.add(offer.buyerTokenAddress);
    });

    const tokenArray = Array.from(uniqueTokens);
    console.log(`Fetching info for ${tokenArray.length} unique tokens`);

    // Try to load from Redis cache first
    if (useRedis) {
      const cacheKeys = tokenArray.map(token => `${CACHE_PREFIX.TOKEN_INFO}${chainId}:${token}`);
      const cachedTokenInfo = await redisCache.getMultipleCache<{ tokenType: number; name: string; symbol: string }>(cacheKeys);
      
      cachedTokenInfo.forEach((value, key) => {
        const tokenAddress = key.replace(`${CACHE_PREFIX.TOKEN_INFO}${chainId}:`, '');
        tokenInfoCache.set(tokenAddress, value);
      });
    }

    // Fetch token info from contract in batches (only for missing tokens)
    const missingTokens = tokenArray.filter(token => !tokenInfoCache.has(token));
    console.log(`Found ${tokenArray.length - missingTokens.length} cached token info, fetching ${missingTokens.length} missing`);

    const tokenInfoBatchSize = 15;
    const tokensToCache: Array<{ key: string; value: any }> = [];
    
    for (let i = 0; i < missingTokens.length; i += tokenInfoBatchSize) {
      const batch = missingTokens.slice(i, i + tokenInfoBatchSize);
      const promises = batch.map(async (tokenAddress) => {
        try {
          const tokenInfo = await yamContract.tokenInfo(tokenAddress);
          const [tokenType, name, symbol] = tokenInfo;
          const info = {
            tokenType: tokenType.toNumber(),
            name,
            symbol,
          };
          tokenInfoCache.set(tokenAddress, info);
          
          if (useRedis) {
            tokensToCache.push({
              key: `${CACHE_PREFIX.TOKEN_INFO}${chainId}:${tokenAddress}`,
              value: info,
            });
          }
        } catch (error) {
          console.error(`Error fetching tokenInfo for ${tokenAddress}:`, error);
        }
      });
      
      await Promise.all(promises);
      if (i + tokenInfoBatchSize < missingTokens.length) {
        await delay(100);
      }
    }

    // Cache token info in Redis
    if (useRedis && tokensToCache.length > 0) {
      await redisCache.setMultipleCache(tokensToCache, CACHE_TTL.TOKEN_INFO);
    }

    // Step 3: Fetch decimals for unique tokens
    if (useRedis) {
      const cacheKeys = tokenArray.map(token => `${CACHE_PREFIX.TOKEN_DECIMALS}${chainId}:${token}`);
      const cachedDecimals = await redisCache.getMultipleCache<number>(cacheKeys);
      
      cachedDecimals.forEach((value, key) => {
        const tokenAddress = key.replace(`${CACHE_PREFIX.TOKEN_DECIMALS}${chainId}:`, '');
        tokenDecimalsCache.set(tokenAddress, value);
      });
    }

    const missingDecimals = tokenArray.filter(token => !tokenDecimalsCache.has(token));
    console.log(`Found ${tokenArray.length - missingDecimals.length} cached decimals, fetching ${missingDecimals.length} missing`);

    const decimalsBatchSize = 20;
    const decimalsToCache: Array<{ key: string; value: any }> = [];
    
    for (let i = 0; i < missingDecimals.length; i += decimalsBatchSize) {
      const batch = missingDecimals.slice(i, i + decimalsBatchSize);
      const promises = batch.map(async (tokenAddress) => {
        try {
          const info = await getTokenInfo(tokenAddress, provider);
          tokenDecimalsCache.set(tokenAddress, info.decimals);
          
          if (useRedis) {
            decimalsToCache.push({
              key: `${CACHE_PREFIX.TOKEN_DECIMALS}${chainId}:${tokenAddress}`,
              value: info.decimals,
            });
          }
        } catch (error) {
          console.error(`Error fetching decimals for ${tokenAddress}:`, error);
          const defaultValue = 18;
          tokenDecimalsCache.set(tokenAddress, defaultValue);
          
          if (useRedis) {
            decimalsToCache.push({
              key: `${CACHE_PREFIX.TOKEN_DECIMALS}${chainId}:${tokenAddress}`,
              value: defaultValue,
            });
          }
        }
      });
      
      await Promise.all(promises);
      if (i + decimalsBatchSize < missingDecimals.length) {
        await delay(100);
      }
    }

    // Cache decimals in Redis
    if (useRedis && decimalsToCache.length > 0) {
      await redisCache.setMultipleCache(decimalsToCache, CACHE_TTL.TOKEN_DECIMALS);
    }

    // Step 4: Collect unique account-token pairs for balance/allowance fetching
    const uniqueAccountTokens = new Set<string>();
    offerDataArray.forEach(offer => {
      const accountKey = `${offer.seller}-${offer.offerTokenAddress}`;
      uniqueAccountTokens.add(accountKey);
    });

    // Step 5: Fetch balances and allowances
    if (useRedis) {
      const accountTokenArray = Array.from(uniqueAccountTokens);
      const cacheKeys = accountTokenArray.map(key => `${CACHE_PREFIX.ACCOUNT_BALANCE}${chainId}:${key}`);
      const cachedBalances = await redisCache.getMultipleCache<DataRealtokenType>(cacheKeys);
      
      cachedBalances.forEach((value, key) => {
        const accountKey = key.replace(`${CACHE_PREFIX.ACCOUNT_BALANCE}${chainId}:`, '');
        accountRealtokenMap.set(accountKey, value);
      });
    }

    const missingBalances = Array.from(uniqueAccountTokens).filter(key => !accountRealtokenMap.has(key));
    console.log(`Found ${uniqueAccountTokens.size - missingBalances.length} cached balances, fetching ${missingBalances.length} missing`);

    const balanceBatchSize = 10;
    const balancesToCache: Array<{ key: string; value: any }> = [];
    
    for (let i = 0; i < missingBalances.length; i += balanceBatchSize) {
      const batch = missingBalances.slice(i, i + balanceBatchSize);
      const promises = batch.map(async (accountKey) => {
        const [seller, tokenAddress] = accountKey.split('-');
        const tokenInfo = tokenInfoCache.get(tokenAddress);
        
        // Only fetch for RealTokens (type 1) or if we don't know the type yet
        if (!tokenInfo || tokenInfo.tokenType === 1) {
          try {
            const contract = new Contract(tokenAddress, erc20ABI, provider);
            const [balance, allowance] = await Promise.all([
              contract.balanceOf(seller),
              contract.allowance(seller, yamContractAddress),
            ]);
            
            const balanceData: DataRealtokenType = {
              id: accountKey,
              amount: balance.toString(),
              allowance: allowance.toString(),
            };
            
            accountRealtokenMap.set(accountKey, balanceData);
            
            if (useRedis) {
              balancesToCache.push({
                key: `${CACHE_PREFIX.ACCOUNT_BALANCE}${chainId}:${accountKey}`,
                value: balanceData,
              });
            }
          } catch (error) {
            console.error(`Error fetching balance/allowance for ${accountKey}:`, error);
            const balanceData: DataRealtokenType = {
              id: accountKey,
              amount: '0',
              allowance: '0',
            };
            accountRealtokenMap.set(accountKey, balanceData);
            
            if (useRedis) {
              balancesToCache.push({
                key: `${CACHE_PREFIX.ACCOUNT_BALANCE}${chainId}:${accountKey}`,
                value: balanceData,
              });
            }
          }
        }
      });
      
      await Promise.all(promises);
      if (i + balanceBatchSize < missingBalances.length) {
        await delay(150);
      }
    }

    // Cache balances in Redis
    if (useRedis && balancesToCache.length > 0) {
      await redisCache.setMultipleCache(balancesToCache, CACHE_TTL.ACCOUNT_BALANCE);
    }

    // Step 6: Process offers with cached data
    const extendedTokensAddress = getExtendedTokens(chainId).map((token) => token.contractAddress);
    
    for (const offerData of offerDataArray) {
      try {
        const offerTokenInfo = tokenInfoCache.get(offerData.offerTokenAddress);
        const buyerTokenInfo = tokenInfoCache.get(offerData.buyerTokenAddress);
        
        if (!offerTokenInfo || !buyerTokenInfo) {
          console.warn(`Missing token info for offer ${offerData.offerId}`);
          continue;
        }

        const offerTokenDecimals = tokenDecimalsCache.get(offerData.offerTokenAddress) || 18;
        const buyerTokenDecimals = tokenDecimalsCache.get(offerData.buyerTokenAddress) || 18;

        const accountKey = `${offerData.seller}-${offerData.offerTokenAddress}`;
        const accountUserRealtoken = accountRealtokenMap.get(accountKey);
        
        let balance = '0';
        let allowance = '0';
        
        if (offerTokenInfo.tokenType === 1 && accountUserRealtoken) {
          balance = accountUserRealtoken.amount;
          allowance = accountUserRealtoken.allowance;
        } else if (accountUserRealtoken) {
          balance = accountUserRealtoken.amount;
          allowance = accountUserRealtoken.allowance;
        }

        const availableAmount = BigNumber.minimum(
          offerData.amount,
          balance,
          allowance
        ).toString();

        const offerGraphQl = {
          id: offerData.offerId.toString(),
          seller: {
            address: offerData.seller,
          },
          offerToken: {
            address: offerData.offerTokenAddress,
            name: offerTokenInfo.name,
            symbol: offerTokenInfo.symbol,
            decimals: offerTokenDecimals.toString(),
            tokenType: offerTokenInfo.tokenType,
          },
          buyerToken: {
            address: offerData.buyerTokenAddress,
            name: buyerTokenInfo.name,
            symbol: buyerTokenInfo.symbol,
            decimals: buyerTokenDecimals.toString(),
            tokenType: buyerTokenInfo.tokenType,
          },
          buyer: offerData.buyer !== '0x0000000000000000000000000000000000000000' ? {
            address: offerData.buyer,
          } : null,
          price: {
            price: offerData.price,
            amount: offerData.amount,
          },
          availableAmount: availableAmount,
          balance: offerTokenInfo.tokenType !== 1 ? {
            amount: balance,
          } : null,
          allowance: offerTokenInfo.tokenType !== 1 ? {
            allowance: allowance,
          } : null,
          createdAtTimestamp: 0,
          removedAtBlock: null,
        } as any;

        const parsedOffer = await parseOffer(
          account,
          offerGraphQl,
          accountUserRealtoken,
          propertiesToken,
          wlProperties,
          prices,
          extendedTokensAddress
        );

        userOffers.push(parsedOffer);
      } catch (error) {
        console.error(`Error parsing offer ${offerData.offerId}:`, error);
      }
    }

    console.log('User offers formatted', userOffers.length);
    return userOffers;
  } catch (error) {
    console.error('Error while fetching user offers via RPC:', error);
    throw error;
  }
};

