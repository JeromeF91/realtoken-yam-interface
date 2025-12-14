import { JsonRpcProvider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import { utils } from 'ethers';
import BigNumber from 'bignumber.js';
import { CHAINS, ChainsID } from '../../constants';
import { realTokenYamUpgradeableABI } from '../../abis';
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
 * Fetch all offers using RPC calls (replaces GraphQL)
 * This fetches quantity (amount) and price directly from the contract
 */
export const fetchAllOffersRpc = async (
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

    const yamContract = new Contract(
      yamContractAddress,
      realTokenYamUpgradeableABI,
      provider
    ) as RealTokenYamUpgradeable;

    // Get total offer count using callStatic
    const offerCountBN = await yamContract.callStatic.getOfferCount();
    const offerCount = offerCountBN.toNumber();
    console.log(`Fetching all ${offerCount} offers on chain ${chainId} via RPC`);

    if (offerCount === 0) {
      return [];
    }

    const contractInterface = new utils.Interface(realTokenYamUpgradeableABI);
    const allOfferIds = Array.from({ length: offerCount }, (_, i) => i);
    
    // Fetch all offers using multicall in batches
    const multicallBatchSize = 100;
    const offerResults: Array<{ offerId: number; success: boolean; data: any }> = [];
    
    for (let i = 0; i < allOfferIds.length; i += multicallBatchSize) {
      const batchIds = allOfferIds.slice(i, i + multicallBatchSize);
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
      } catch (batchError: any) {
        console.error(`Error fetching multicall batch for offers ${batchIds[0]}-${batchIds[batchIds.length - 1]}:`, batchError);
        // Mark all offers in this batch as failed
        batchIds.forEach(offerId => offerResults.push({ offerId, success: false, data: null }));
      }
      
      // Rate limiting between batches
      if (i + multicallBatchSize < allOfferIds.length) {
        await delay(50);
      }
    }

    // Process offers and extract data
    const offerDataArray: Array<{
      offerId: number;
      seller: string;
      offerTokenAddress: string;
      buyerTokenAddress: string;
      buyer: string;
      priceBN: any;
      amountBN: any;
    }> = [];

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
          priceBN,
          amountBN,
        });
      } catch (error: any) {
        console.error(`Error processing offer ${offerId}:`, error);
      }
    });

    console.log(`Successfully fetched ${offerDataArray.length} offers from contract`);

    if (offerDataArray.length === 0) {
      return [];
    }

    // Collect unique tokens
    const uniqueTokens = new Set<string>();
    offerDataArray.forEach(offer => {
      uniqueTokens.add(offer.offerTokenAddress);
      uniqueTokens.add(offer.buyerTokenAddress);
    });

    const tokenArray = Array.from(uniqueTokens);
    console.log(`Fetching info for ${tokenArray.length} unique tokens`);

    // Cache for token info
    const tokenInfoCache = new Map<string, { tokenType: number; name: string; symbol: string }>();
    const tokenDecimalsCache = new Map<string, number>();

    // Fetch token info in batches
    const tokenInfoBatchSize = 50;
    for (let i = 0; i < tokenArray.length; i += tokenInfoBatchSize) {
      const batch = tokenArray.slice(i, i + tokenInfoBatchSize);
      const promises = batch.map(async (tokenAddress) => {
        try {
          const tokenInfo = await yamContract.callStatic.tokenInfo(tokenAddress);
          const [tokenType, name, symbol] = tokenInfo;
          tokenInfoCache.set(tokenAddress, {
            tokenType: tokenType.toNumber(),
            name,
            symbol,
          });

          // Get decimals
          try {
            const erc20Info = await getTokenInfo(tokenAddress, provider);
            tokenDecimalsCache.set(tokenAddress, erc20Info.decimals);
          } catch (e) {
            console.warn(`Could not get decimals for ${tokenAddress}, using default 18`);
            tokenDecimalsCache.set(tokenAddress, 18);
          }
        } catch (error) {
          console.error(`Error fetching tokenInfo for ${tokenAddress}:`, error);
          // Use fallback
          try {
            const erc20Info = await getTokenInfo(tokenAddress, provider);
            tokenInfoCache.set(tokenAddress, {
              tokenType: 3, // Default to ERC20
              name: erc20Info.name,
              symbol: erc20Info.symbol,
            });
            tokenDecimalsCache.set(tokenAddress, erc20Info.decimals);
          } catch (e) {
            console.error(`Failed to get ERC20 info for ${tokenAddress}:`, e);
            tokenInfoCache.set(tokenAddress, {
              tokenType: 3,
              name: 'Unknown Token',
              symbol: 'UNKNOWN',
            });
            tokenDecimalsCache.set(tokenAddress, 18);
          }
        }
      });
      await Promise.all(promises);
      
      if (i + tokenInfoBatchSize < tokenArray.length) {
        await delay(50);
      }
    }

    // Fetch balances and allowances for all sellers
    const accountRealtokenMap = new Map<string, DataRealtokenType>();
    const uniqueSellerTokens = new Set<string>();
    offerDataArray.forEach(offer => {
      uniqueSellerTokens.add(`${offer.seller}-${offer.offerTokenAddress}`);
    });

    const sellerTokenArray = Array.from(uniqueSellerTokens);
    console.log(`Fetching balances/allowances for ${sellerTokenArray.length} seller-token pairs`);

    // Fetch balances and allowances in batches
    const balanceBatchSize = 20;
    for (let i = 0; i < sellerTokenArray.length; i += balanceBatchSize) {
      const batch = sellerTokenArray.slice(i, i + balanceBatchSize);
      const promises = batch.map(async (sellerToken) => {
        const [seller, tokenAddress] = sellerToken.split('-');
        try {
          const { getTokenBalanceAndAllowance } = await import('./rpcHelpers');
          const balanceAndAllowance = await getTokenBalanceAndAllowance(
            tokenAddress,
            seller,
            yamContractAddress,
            provider
          );
          accountRealtokenMap.set(sellerToken, {
            id: sellerToken,
            amount: balanceAndAllowance.balance,
            allowance: balanceAndAllowance.allowance,
          });
        } catch (error) {
          console.error(`Error fetching balance/allowance for ${sellerToken}:`, error);
          accountRealtokenMap.set(sellerToken, {
            id: sellerToken,
            amount: '0',
            allowance: '0',
          });
        }
      });
      await Promise.all(promises);
      
      if (i + balanceBatchSize < sellerTokenArray.length) {
        await delay(50);
      }
    }

    // Parse all offers
    const extendedTokensAddress = getExtendedTokens(chainId).map((token) => token.contractAddress);
    const parsedOffers: Offer[] = [];

    for (const offerData of offerDataArray) {
      try {
        const offerTokenInfo = tokenInfoCache.get(offerData.offerTokenAddress);
        const buyerTokenInfo = tokenInfoCache.get(offerData.buyerTokenAddress);
        const offerTokenDecimals = tokenDecimalsCache.get(offerData.offerTokenAddress) || 18;
        const buyerTokenDecimals = tokenDecimalsCache.get(offerData.buyerTokenAddress) || 18;

        if (!offerTokenInfo || !buyerTokenInfo) {
          console.warn(`Missing token info for offer ${offerData.offerId}`);
          continue;
        }

        const accountUserRealtoken = accountRealtokenMap.get(
          `${offerData.seller}-${offerData.offerTokenAddress}`
        ) || { id: '', amount: '0', allowance: '0' };

        // Calculate price per unit
        const pricePerUnit = new BigNumber(offerData.priceBN.toString())
          .multipliedBy(new BigNumber(10).pow(offerTokenDecimals))
          .dividedBy(new BigNumber(offerData.amountBN.toString()))
          .dividedBy(new BigNumber(10).pow(buyerTokenDecimals))
          .toString();

        // Create GraphQL-like structure
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
            price: pricePerUnit,
            amount: offerData.amountBN.toString(),
          },
          availableAmount: offerData.amountBN.toString(),
          balance: offerTokenInfo.tokenType !== 1 ? {
            amount: accountUserRealtoken.amount,
          } : null,
          allowance: offerTokenInfo.tokenType !== 1 ? {
            allowance: accountUserRealtoken.allowance,
          } : null,
          createdAtTimestamp: 0,
          removedAtBlock: null,
        } as any;

        const offer = await parseOffer(
          account,
          offerGraphQl,
          accountUserRealtoken,
          propertiesToken,
          wlProperties,
          prices,
          extendedTokensAddress
        );

        const hasPropertyToken = propertiesToken.find(
          propertyToken => 
            propertyToken.contractAddress == offer.buyerTokenAddress || 
            propertyToken.contractAddress == offer.offerTokenAddress
        );
        offer.hasPropertyToken = hasPropertyToken ? true : false;

        parsedOffers.push(offer);
      } catch (error: any) {
        console.error(`Error parsing offer ${offerData.offerId}:`, error);
      }
    }

    console.log(`Successfully parsed ${parsedOffers.length} offers`);
    return parsedOffers;
  } catch (error) {
    console.error('Error while fetching all offers via RPC:', error);
    throw error;
  }
};

