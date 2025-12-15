import { JsonRpcProvider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import { utils } from 'ethers';
import BigNumber from 'bignumber.js';
import { CHAINS, ChainsID } from '../../constants';
import { realTokenYamUpgradeableABI, Erc20ABI } from '../../abis';
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
 * Delay function for rate limiting
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

    // In-memory caches
    const tokenInfoCache = new Map<string, { tokenType: number; name: string; symbol: string }>();
    const tokenDecimalsCache = new Map<string, number>();
    const accountRealtokenMap = new Map<string, DataRealtokenType>();

    // Step 1: Query OfferCreated events filtered by seller address to get only user's offers
    // This is much more efficient than fetching all offers
    const userAddressLower = account.toLowerCase();
    const contractInterface = new utils.Interface(realTokenYamUpgradeableABI);
    
    console.log(`Querying OfferCreated events for seller: ${userAddressLower}`);
    
    // Query events from block 0 to latest (or use a reasonable range)
    // For efficiency, we could cache the last queried block
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 100000); // Last ~100k blocks should be enough
    const toBlock = currentBlock;
    
    const offerCreatedFilter = yamContract.filters.OfferCreated(null, userAddressLower, null);
    const events = await yamContract.queryFilter(offerCreatedFilter, fromBlock, toBlock);
    
    console.log(`Found ${events.length} OfferCreated events for user ${account}`);
    
    if (events.length === 0) {
      return [];
    }

    // Extract offer IDs from events
    const userOfferIds: number[] = [];
    events.forEach(event => {
      if (event.args && event.args.offerId !== undefined) {
        const offerId = event.args.offerId.toNumber();
        userOfferIds.push(offerId);
      }
    });

    console.log(`Found ${userOfferIds.length} offer IDs for user ${account}`);

    if (userOfferIds.length === 0) {
      return [];
    }

    // Limit the number of offers to fetch to prevent excessive RPC calls
    // If user has too many offers, we'll only fetch the most recent ones
    const MAX_OFFERS_TO_FETCH = 100;
    const offersToFetch = userOfferIds.length > MAX_OFFERS_TO_FETCH 
      ? userOfferIds.slice(-MAX_OFFERS_TO_FETCH) // Get most recent offers
      : userOfferIds;
    
    if (userOfferIds.length > MAX_OFFERS_TO_FETCH) {
      console.warn(`User has ${userOfferIds.length} offers, limiting to ${MAX_OFFERS_TO_FETCH} most recent offers to prevent excessive RPC calls`);
    }

    // Step 2: Fetch only the user's offers using multicall
    const offerDataArray: Array<{
      offerId: number;
      seller: string;
      offerTokenAddress: string;
      buyerTokenAddress: string;
      buyer: string;
      price: string;
      amount: string;
    }> = [];

    // Fetch offers using multicall in batches
    const multicallBatchSize = 100;
    const offerResults: Array<{ offerId: number; success: boolean; data: any }> = [];
    
    for (let i = 0; i < offersToFetch.length; i += multicallBatchSize) {
      const batchIds = offersToFetch.slice(i, i + multicallBatchSize);
      
      try {
        const batchResults = await batchShowOffers(
          provider,
          yamContractAddress,
          contractInterface,
          batchIds
        );
        
        batchResults.forEach((result, index) => {
          offerResults.push({
            offerId: batchIds[index],
            success: result.success,
            data: result.data,
          });
        });
      } catch (error: any) {
        console.error(`Error fetching offers batch ${i}-${i + batchIds.length}:`, error);
        batchIds.forEach(offerId => {
          offerResults.push({
            offerId,
            success: false,
            data: null,
          });
        });
      }
      
      if (i + multicallBatchSize < offersToFetch.length) {
        await delay(50);
      }
    }
    
    // Extract data from successful results
    offerResults.forEach(({ offerId, success, data }) => {
      if (!success || !data) {
        return; // Skip failed calls
      }
      
      try {
        const [seller, offerTokenAddress, buyerTokenAddress, buyer, priceBN, amountBN] = data;
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
        console.warn(`Error processing offer ${offerId}:`, error);
      }
    });

    console.log(`Successfully fetched ${offerDataArray.length} offers for user ${account}`);

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

    // Fetch token info from contract in batches
    const tokenInfoBatchSize = 15;
    
    for (let i = 0; i < tokenArray.length; i += tokenInfoBatchSize) {
      const batch = tokenArray.slice(i, i + tokenInfoBatchSize);
      const promises = batch.map(async (tokenAddress) => {
        // Skip if already cached
        if (tokenInfoCache.has(tokenAddress)) {
          return;
        }
        
        try {
          const tokenInfo = await yamContract.callStatic.tokenInfo(tokenAddress);
          const [tokenType, name, symbol] = tokenInfo;
          const info = {
            tokenType: typeof tokenType === 'number' ? tokenType : (tokenType as any).toNumber(),
            name,
            symbol,
          };
          tokenInfoCache.set(tokenAddress, info);
        } catch (error) {
          console.error(`Error fetching tokenInfo for ${tokenAddress}:`, error);
        }
      });
      
      await Promise.all(promises);
      if (i + tokenInfoBatchSize < tokenArray.length) {
        await delay(100);
      }
    }

    // Step 3: Fetch decimals for unique tokens
    const decimalsBatchSize = 20;
    
    for (let i = 0; i < tokenArray.length; i += decimalsBatchSize) {
      const batch = tokenArray.slice(i, i + decimalsBatchSize);
      const promises = batch.map(async (tokenAddress) => {
        // Skip if already cached
        if (tokenDecimalsCache.has(tokenAddress)) {
          return;
        }
        
        try {
          const info = await getTokenInfo(tokenAddress, provider);
          tokenDecimalsCache.set(tokenAddress, info.decimals);
        } catch (error) {
          console.error(`Error fetching decimals for ${tokenAddress}:`, error);
          const defaultValue = 18;
          tokenDecimalsCache.set(tokenAddress, defaultValue);
        }
      });
      
      await Promise.all(promises);
      if (i + decimalsBatchSize < tokenArray.length) {
        await delay(100);
      }
    }

    // Step 4: Collect unique account-token pairs for balance/allowance fetching
    const uniqueAccountTokens = new Set<string>();
    offerDataArray.forEach(offer => {
      const accountKey = `${offer.seller}-${offer.offerTokenAddress}`;
      uniqueAccountTokens.add(accountKey);
    });

    // Step 5: Fetch balances and allowances
    const balanceBatchSize = 10;
    const accountTokenArray = Array.from(uniqueAccountTokens);
    
    for (let i = 0; i < accountTokenArray.length; i += balanceBatchSize) {
      const batch = accountTokenArray.slice(i, i + balanceBatchSize);
      const promises = batch.map(async (accountKey) => {
        // Skip if already cached
        if (accountRealtokenMap.has(accountKey)) {
          return;
        }
        
        const [seller, tokenAddress] = accountKey.split('-');
        const tokenInfo = tokenInfoCache.get(tokenAddress);
        
        // Only fetch for RealTokens (type 1) or if we don't know the type yet
        if (!tokenInfo || tokenInfo.tokenType === 1) {
          try {
            const contract = new Contract(tokenAddress, Erc20ABI, provider);
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
          } catch (error) {
            console.error(`Error fetching balance/allowance for ${accountKey}:`, error);
            const balanceData: DataRealtokenType = {
              id: accountKey,
              amount: '0',
              allowance: '0',
            };
            accountRealtokenMap.set(accountKey, balanceData);
          }
        }
      });
      
      await Promise.all(promises);
      if (i + balanceBatchSize < accountTokenArray.length) {
        await delay(150);
      }
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

