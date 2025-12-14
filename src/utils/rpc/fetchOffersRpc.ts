import { JsonRpcProvider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import BigNumber from 'bignumber.js';
import { CHAINS, ChainsID } from '../../constants';
import { realTokenYamUpgradeableABI, erc20ABI } from '../../abis';
import { RealTokenYamUpgradeable } from '../../abis/types/RealTokenYamUpgradeable';
import { getRpcProvider, getTokenInfo } from './rpcHelpers';
import { Offer } from '../../types/offer/Offer';
import { PropertiesToken } from '../../types';
import { Price } from '../../types/price';
import { DataRealtokenType } from '../../types/offer/DataRealTokenType';
import { parseOffer } from '../offers/parseOffer';
import { getExtendedTokens } from '../../constants/GetPriceToken';
import { getCache, setCache, getMultipleCache, setMultipleCache, isRedisAvailable } from './redisCache';

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
  OFFER_COUNT: 'offer:count:',
};

/**
 * Cache TTL in seconds
 */
const CACHE_TTL = {
  TOKEN_INFO: 3600, // 1 hour - token info rarely changes
  TOKEN_DECIMALS: 3600, // 1 hour
  ACCOUNT_BALANCE: 60, // 1 minute - balances change frequently
  OFFER_COUNT: 30, // 30 seconds
};

/**
 * Fetch offers using RPC calls instead of TheGraph
 * Optimized to minimize RPC requests through caching and batching
 */
export const fetchOffersRpc = async (
  account: string,
  chainId: number,
  propertiesToken: PropertiesToken[],
  wlProperties: number[],
  prices: Price,
  setTheGraphIssue: (value: boolean) => void
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
    console.log('Amount of offersToFetch: ', offerCount);

    if (offerCount === 0) {
      return [];
    }

    // Check if Redis is available
    const useRedis = await isRedisAvailable();
    console.log(`Using Redis cache: ${useRedis}`);

    // In-memory caches as fallback
    const tokenInfoCache = new Map<string, { tokenType: number; name: string; symbol: string }>();
    const tokenDecimalsCache = new Map<string, number>();
    const accountRealtokenMap = new Map<string, DataRealtokenType>();

    // Reduced batch size to limit concurrent requests
    const batchSize = 10;
    const offers: Offer[] = [];
    const offerDataArray: Array<{
      offerId: number;
      seller: string;
      offerTokenAddress: string;
      buyerTokenAddress: string;
      buyer: string;
      price: string;
      amount: string;
    }> = [];

    // Step 1: Fetch all offer data in small batches with rate limiting
    for (let i = 0; i < offerCount; i += batchSize) {
      const batchEnd = Math.min(i + batchSize, offerCount);
      const batchPromises: Promise<void>[] = [];

      for (let offerId = i; offerId < batchEnd; offerId++) {
        batchPromises.push(
          (async () => {
            try {
              const offerData = await yamContract.showOffer(offerId);
              const [seller, offerTokenAddress, buyerTokenAddress, buyer, priceBN, amountBN] = offerData;
              
              offerDataArray.push({
                offerId,
                seller: seller.toLowerCase(),
                offerTokenAddress: offerTokenAddress.toLowerCase(),
                buyerTokenAddress: buyerTokenAddress.toLowerCase(),
                buyer: buyer.toLowerCase(),
                price: priceBN.toString(),
                amount: amountBN.toString(),
              });
            } catch (error) {
              console.error(`Error fetching offer ${offerId}:`, error);
            }
          })()
        );
      }

      await Promise.all(batchPromises);
      
      // Rate limiting: delay between batches
      if (i + batchSize < offerCount) {
        await delay(100); // 100ms delay between batches
      }
    }

    console.log(`Fetched ${offerDataArray.length} offers`);

    // Step 2: Collect unique tokens and fetch token info in batches
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
      const cachedTokenInfo = await getMultipleCache<{ tokenType: number; name: string; symbol: string }>(cacheKeys);
      
      cachedTokenInfo.forEach((value, key) => {
        const tokenAddress = key.replace(`${CACHE_PREFIX.TOKEN_INFO}${chainId}:`, '');
        tokenInfoCache.set(tokenAddress, value);
      });
    }

    // Fetch token info from contract in batches (only for missing tokens)
    const missingTokens = tokenArray.filter(token => !tokenInfoCache.has(token));
    console.log(`Found ${tokenArray.length - missingTokens.length} cached token info, fetching ${missingTokens.length} missing`);

    const tokenInfoBatchSize = 20;
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
      await setMultipleCache(tokensToCache, CACHE_TTL.TOKEN_INFO);
    }

    // Step 3: Fetch decimals for unique tokens in batches
    // Try to load from Redis cache first
    if (useRedis) {
      const cacheKeys = tokenArray.map(token => `${CACHE_PREFIX.TOKEN_DECIMALS}${chainId}:${token}`);
      const cachedDecimals = await getMultipleCache<number>(cacheKeys);
      
      cachedDecimals.forEach((value, key) => {
        const tokenAddress = key.replace(`${CACHE_PREFIX.TOKEN_DECIMALS}${chainId}:`, '');
        tokenDecimalsCache.set(tokenAddress, value);
      });
    }

    const missingDecimals = tokenArray.filter(token => !tokenDecimalsCache.has(token));
    console.log(`Found ${tokenArray.length - missingDecimals.length} cached decimals, fetching ${missingDecimals.length} missing`);

    const decimalsBatchSize = 30;
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
      await setMultipleCache(decimalsToCache, CACHE_TTL.TOKEN_DECIMALS);
    }

    // Step 4: Collect unique account-token pairs for balance/allowance fetching
    const uniqueAccountTokens = new Set<string>();
    offerDataArray.forEach(offer => {
      const accountKey = `${offer.seller}-${offer.offerTokenAddress}`;
      uniqueAccountTokens.add(accountKey);
    });

    // Step 5: Fetch balances and allowances in batches (only for RealTokens)
    // Try to load from Redis cache first
    if (useRedis) {
      const accountTokenArray = Array.from(uniqueAccountTokens);
      const cacheKeys = accountTokenArray.map(key => `${CACHE_PREFIX.ACCOUNT_BALANCE}${chainId}:${key}`);
      const cachedBalances = await getMultipleCache<DataRealtokenType>(cacheKeys);
      
      cachedBalances.forEach((value, key) => {
        const accountKey = key.replace(`${CACHE_PREFIX.ACCOUNT_BALANCE}${chainId}:`, '');
        accountRealtokenMap.set(accountKey, value);
      });
    }

    const missingBalances = Array.from(uniqueAccountTokens).filter(key => !accountRealtokenMap.has(key));
    console.log(`Found ${uniqueAccountTokens.size - missingBalances.length} cached balances, fetching ${missingBalances.length} missing`);

    const balanceBatchSize = 15;
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
        await delay(150); // Slightly longer delay for balance calls
      }
    }

    // Cache balances in Redis
    if (useRedis && balancesToCache.length > 0) {
      await setMultipleCache(balancesToCache, CACHE_TTL.ACCOUNT_BALANCE);
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

        offers.push(parsedOffer);
      } catch (error) {
        console.error(`Error parsing offer ${offerData.offerId}:`, error);
      }
    }

    console.log('Offers formated', offers.length);

    // Check if we got significantly fewer offers than expected
    const ERROR_RANGE = 0.1;
    if (offers.length < offerCount * (1 - ERROR_RANGE)) {
      setTheGraphIssue(true);
    }

    return offers;
  } catch (error) {
    console.error('Error while fetching offers via RPC:', error);
    throw error;
  }
};

