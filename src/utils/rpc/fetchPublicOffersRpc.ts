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
import { DataRealtokenType } from '../../types/offer/DataRealTokenType';
import { parseOffer } from '../offers/parseOffer';
import { getExtendedTokens } from '../../constants/GetPriceToken';
import { batchShowOffers } from './multicall';

/**
 * Delay function for rate limiting
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch the last 10 public offers using RPC calls
 * Public offers are offers with no buyer address (buyer is zero address)
 */
export const fetchPublicOffersRpc = async (
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

    const contractInterface = new utils.Interface(realTokenYamUpgradeableABI);
    
    console.log(`Fetching last 10 public offers on chain ${chainId}`);
    
    // Get total offer count
    const offerCountBN = await yamContract.callStatic.getOfferCount();
    const totalOffers = offerCountBN.toNumber();
    
    console.log(`Total offers on chain ${chainId}: ${totalOffers}`);
    
    if (totalOffers === 0) {
      return [];
    }

    // Fetch the last 10 offers (most recent offer IDs)
    // We'll check more than 10 to account for private offers that we'll filter out
    const MAX_OFFERS_TO_CHECK = 50; // Check up to 50 offers to find 10 public ones
    const startOfferId = Math.max(0, totalOffers - MAX_OFFERS_TO_CHECK);
    const offerIdsToCheck: number[] = [];
    for (let i = totalOffers - 1; i >= startOfferId; i--) {
      offerIdsToCheck.push(i);
    }
    
    console.log(`Checking ${offerIdsToCheck.length} most recent offers to find 10 public offers`);

    // Fetch offers using multicall
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
    const multicallBatchSize = 50;
    const offerResults: Array<{ offerId: number; success: boolean; data: any }> = [];
    
    for (let i = 0; i < offerIdsToCheck.length; i += multicallBatchSize) {
      const batchIds = offerIdsToCheck.slice(i, i + multicallBatchSize);
      
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
      
      if (i + multicallBatchSize < offerIdsToCheck.length) {
        await delay(50);
      }
    }
    
    // Extract data from successful results and filter for public offers only
    // Public offers have buyer address as zero address or null
    offerResults.forEach(({ offerId, success, data }) => {
      if (!success || !data) {
        return; // Skip failed calls
      }
      
      try {
        const [seller, offerTokenAddress, buyerTokenAddress, buyer, priceBN, amountBN] = data;
        
        // Filter for public offers: buyer must be zero address or null
        const buyerAddress = buyer ? buyer.toLowerCase() : '0x0000000000000000000000000000000000000000';
        const isPublicOffer = buyerAddress === '0x0000000000000000000000000000000000000000';
        
        // Also check that amount is positive
        const amountBNCheck = new BigNumber(amountBN.toString());
        const hasPositiveAmount = amountBNCheck.isPositive() && !amountBNCheck.isZero();
        
        if (isPublicOffer && hasPositiveAmount) {
          offerDataArray.push({
            offerId,
            seller: seller.toLowerCase(),
            offerTokenAddress: offerTokenAddress.toLowerCase(),
            buyerTokenAddress: buyerTokenAddress.toLowerCase(),
            buyer: buyerAddress,
            price: priceBN.toString(),
            amount: amountBN.toString(),
          });
        }
      } catch (error) {
        console.warn(`Error processing offer ${offerId}:`, error);
      }
    });

    // Limit to 10 offers (most recent public offers)
    const publicOffersToProcess = offerDataArray.slice(0, 10);
    
    console.log(`Found ${publicOffersToProcess.length} public offers (limited to 10)`);

    if (publicOffersToProcess.length === 0) {
      return [];
    }

    // Step 2: Fetch token info for unique tokens
    const tokenArray = Array.from(new Set([
      ...publicOffersToProcess.map(o => o.offerTokenAddress),
      ...publicOffersToProcess.map(o => o.buyerTokenAddress),
    ]));
    
    const tokenInfoBatchSize = 10;
    for (let i = 0; i < tokenArray.length; i += tokenInfoBatchSize) {
      const batch = tokenArray.slice(i, i + tokenInfoBatchSize);
      const promises = batch.map(async (tokenAddress) => {
        // Skip if already cached
        if (tokenInfoCache.has(tokenAddress)) {
          return;
        }
        
        try {
          const info = await yamContract.callStatic.tokenInfo(tokenAddress);
          const tokenType = info[0];
          const name = info[1];
          const symbol = info[2];
          tokenInfoCache.set(tokenAddress, {
            tokenType: tokenType.toNumber(),
            name,
            symbol,
          });
        } catch (error: any) {
          // Fallback to ERC20 if tokenInfo fails (token might not be registered in YAM contract)
          // This is expected for some tokens, so we silently fall back
          try {
            const erc20Info = await getTokenInfo(tokenAddress, provider);
            let tokenType = 3; // Default to ERC20
            try {
              const tokenTypeBN = await yamContract.callStatic.getTokenType(tokenAddress);
              tokenType = tokenTypeBN.toNumber();
            } catch (e) {
              // Silently use default token type
            }
            tokenInfoCache.set(tokenAddress, {
              tokenType,
              name: erc20Info.name,
              symbol: erc20Info.symbol,
            });
          } catch (erc20Error: any) {
            // Final fallback: use address-based naming
            let tokenType = 3;
            try {
              const tokenTypeBN = await yamContract.callStatic.getTokenType(tokenAddress);
              tokenType = tokenTypeBN.toNumber();
            } catch (e) {
              // Silently use default token type
            }
            const addressShort = `${tokenAddress.substring(0, 6)}...${tokenAddress.substring(38)}`;
            tokenInfoCache.set(tokenAddress, {
              tokenType,
              name: `Token ${addressShort}`,
              symbol: addressShort.toUpperCase(),
            });
          }
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
    publicOffersToProcess.forEach(offer => {
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
              contract.callStatic.balanceOf(seller),
              contract.callStatic.allowance(seller, yamContractAddress),
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
    const publicOffers: Offer[] = [];
    
    for (const offerData of publicOffersToProcess) {
      try {
        const offerTokenInfo = tokenInfoCache.get(offerData.offerTokenAddress);
        const buyerTokenInfo = tokenInfoCache.get(offerData.buyerTokenAddress);
        
        if (!offerTokenInfo || !buyerTokenInfo) {
          console.warn(`Missing token info for offer ${offerData.offerId}`);
          continue;
        }

        // Filter: Only include offers where at least one token is a property token
        // Check if either offerToken or buyerToken is in the propertiesToken array
        const hasPropertyToken = propertiesToken.find(
          propertyToken => 
            propertyToken.contractAddress.toLowerCase() === offerData.offerTokenAddress.toLowerCase() || 
            propertyToken.contractAddress.toLowerCase() === offerData.buyerTokenAddress.toLowerCase()
        );

        if (!hasPropertyToken) {
          // Skip offers that don't involve property tokens
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
          buyer: null, // Public offers have no buyer
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

        publicOffers.push(parsedOffer);
      } catch (error) {
        console.error(`Error parsing offer ${offerData.offerId}:`, error);
      }
    }

    console.log(`Successfully fetched ${publicOffers.length} public offers via RPC`);
    return publicOffers;
  } catch (error) {
    console.error('Error while fetching public offers via RPC:', error);
    throw error;
  }
};

