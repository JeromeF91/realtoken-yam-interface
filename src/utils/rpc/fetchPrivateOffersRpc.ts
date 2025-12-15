import { JsonRpcProvider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import { utils } from 'ethers';
import { CHAINS, ChainsID } from '../../constants';
import { realTokenYamUpgradeableABI } from '../../abis';
import { RealTokenYamUpgradeable } from '../../abis/types/RealTokenYamUpgradeable';
import { getRpcProvider, getTokenInfo, getTokenBalanceAndAllowance } from './rpcHelpers';
import { Offer } from '../../types/offer/Offer';
import { PropertiesToken } from '@realtoken/realt-commons';
import { Price } from '../../types/price';
import { DataRealtokenType } from '../../types/offer/DataRealTokenType';
import { parseOffer } from '../offers/parseOffer';
import { getExtendedTokens } from '../../constants/GetPriceToken';
import { batchShowOffers } from './multicall';
import BigNumber from 'bignumber.js';

/**
 * Delay function for rate limiting
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch private offers where the user is the buyer using RPC calls
 * This queries OfferCreated events filtered by buyer address
 */
export const fetchPrivateOffersRpc = async (
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

    const userAddressLower = account.toLowerCase();
    const contractInterface = new utils.Interface(realTokenYamUpgradeableABI);
    
    console.log(`Querying OfferCreated events for buyer: ${userAddressLower}`);
    
    // Query events from block 0 to latest (or use a reasonable range)
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 100000); // Last ~100k blocks should be enough
    const toBlock = currentBlock;
    
    // Filter by buyer address (third parameter in OfferCreated event)
    // OfferCreated event signature: OfferCreated(uint256 indexed offerId, address indexed seller, address indexed buyer)
    const offerCreatedFilter = yamContract.filters.OfferCreated(null, null, userAddressLower);
    const events = await yamContract.queryFilter(offerCreatedFilter, fromBlock, toBlock);
    
    console.log(`Found ${events.length} OfferCreated events for buyer ${account}`);
    
    if (events.length === 0) {
      return [];
    }

    // Extract offer IDs from events
    const privateOfferIds: number[] = [];
    events.forEach(event => {
      if (event.args && event.args.offerId !== undefined) {
        const offerId = event.args.offerId.toNumber();
        privateOfferIds.push(offerId);
      }
    });

    console.log(`Found ${privateOfferIds.length} private offer IDs for user ${account}`);

    if (privateOfferIds.length === 0) {
      return [];
    }

    // Limit the number of offers to fetch to prevent excessive RPC calls
    const MAX_OFFERS_TO_FETCH = 100;
    const offersToFetch = privateOfferIds.length > MAX_OFFERS_TO_FETCH 
      ? privateOfferIds.slice(-MAX_OFFERS_TO_FETCH) // Get most recent offers
      : privateOfferIds;
    
    if (privateOfferIds.length > MAX_OFFERS_TO_FETCH) {
      console.warn(`User has ${privateOfferIds.length} private offers, limiting to ${MAX_OFFERS_TO_FETCH} most recent offers to prevent excessive RPC calls`);
    }

    // Step 2: Fetch only the private offers using multicall
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
        console.error(`Error fetching private offers batch ${i}-${i + batchIds.length}:`, error);
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
    
    // Extract data from successful results and verify buyer matches
    offerResults.forEach(({ offerId, success, data }) => {
      if (!success || !data) {
        return; // Skip failed calls
      }
      
      try {
        const [seller, offerTokenAddress, buyerTokenAddress, buyer, priceBN, amountBN] = data;
        
        // Double-check that buyer matches (should already be filtered by event query)
        if (buyer.toLowerCase() === userAddressLower) {
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
        console.warn(`Error processing private offer ${offerId}:`, error);
      }
    });

    console.log(`Successfully fetched ${offerDataArray.length} private offers for user ${account}`);

    if (offerDataArray.length === 0) {
      return [];
    }

    // Step 3: Fetch token info and process offers (similar to fetchUserOffersRpc)
    const extendedTokensAddress = getExtendedTokens(chainId).map((token) => token.contractAddress);

    const promises = offerDataArray.map(
      (offerData) =>
        new Promise<Offer>(async (resolve, reject) => {
          try {
            const offerTokenAddress = offerData.offerTokenAddress;
            const buyerTokenAddress = offerData.buyerTokenAddress;
            const seller = offerData.seller;
            const offerId = offerData.offerId;
            const priceBN = new BigNumber(offerData.price);
            const amountBN = new BigNumber(offerData.amount);

            // Fetch token info with fallback
            const getTokenInfoWithFallback = async (tokenAddress: string, tokenName: string) => {
              try {
                const info = await yamContract.callStatic.tokenInfo(tokenAddress);
                return info;
              } catch (error: any) {
                console.warn(`tokenInfo failed for ${tokenName} ${tokenAddress}, using ERC20 fallback:`, error?.message);
                try {
                  const erc20Info = await getTokenInfo(tokenAddress, provider);
                  let tokenType = 3; // Default to ERC20
                  try {
                    const tokenTypeBN = await yamContract.callStatic.getTokenType(tokenAddress);
                    tokenType = tokenTypeBN.toNumber();
                  } catch (e) {
                    console.warn(`Could not get tokenType for ${tokenName}, using default 3`);
                  }
                  return [
                    { toNumber: () => tokenType } as any,
                    erc20Info.name,
                    erc20Info.symbol,
                  ];
                } catch (erc20Error: any) {
                  console.warn(`Failed to get ERC20 info for ${tokenName} ${tokenAddress}:`, erc20Error?.message);
                  let tokenType = 3;
                  try {
                    const tokenTypeBN = await yamContract.callStatic.getTokenType(tokenAddress);
                    tokenType = tokenTypeBN.toNumber();
                  } catch (e) {
                    console.warn(`Could not get tokenType for ${tokenName}, using default 3`);
                  }
                  const addressShort = `${tokenAddress.substring(0, 6)}...${tokenAddress.substring(38)}`;
                  return [
                    { toNumber: () => tokenType } as any,
                    `Token ${addressShort}`,
                    addressShort.toUpperCase(),
                  ];
                }
              }
            };
            
            let offerTokenInfo, buyerTokenInfo;
            try {
              [offerTokenInfo, buyerTokenInfo] = await Promise.all([
                getTokenInfoWithFallback(offerTokenAddress, 'offerToken'),
                getTokenInfoWithFallback(buyerTokenAddress, 'buyerToken'),
              ]);
            } catch (error: any) {
              console.error('Critical error fetching token info:', error);
              reject(new Error(`Failed to fetch token information: ${error?.message}`));
              return;
            }

            const [offerTokenType, offerTokenName, offerTokenSymbol] = offerTokenInfo;
            const [buyerTokenType, buyerTokenName, buyerTokenSymbol] = buyerTokenInfo;

            const [offerTokenDecimals, buyerTokenDecimals] = await Promise.all([
              getTokenInfo(offerTokenAddress, provider)
                .then(info => info.decimals)
                .catch(() => {
                  console.warn(`Could not get decimals for offerToken ${offerTokenAddress}, using default 18`);
                  return 18;
                }),
              getTokenInfo(buyerTokenAddress, provider)
                .then(info => info.decimals)
                .catch(() => {
                  console.warn(`Could not get decimals for buyerToken ${buyerTokenAddress}, using default 18`);
                  return 18;
                }),
            ]);

            const balanceAndAllowance = await getTokenBalanceAndAllowance(
              offerTokenAddress,
              seller,
              yamContractAddress,
              provider
            );

            const accountUser: DataRealtokenType = {
              id: `${seller.toLowerCase()}-${offerTokenAddress.toLowerCase()}`,
              amount: balanceAndAllowance.balance,
              allowance: balanceAndAllowance.allowance,
            };

            const offerGraphQl = {
              id: offerId.toString(),
              seller: {
                address: seller.toLowerCase(),
              },
              offerToken: {
                address: offerTokenAddress.toLowerCase(),
                name: offerTokenName,
                symbol: offerTokenSymbol,
                decimals: offerTokenDecimals.toString(),
                tokenType: offerTokenType.toNumber(),
              },
              buyerToken: {
                address: buyerTokenAddress.toLowerCase(),
                name: buyerTokenName,
                symbol: buyerTokenSymbol,
                decimals: buyerTokenDecimals.toString(),
                tokenType: buyerTokenType.toNumber(),
              },
              buyer: buyer !== '0x0000000000000000000000000000000000000000' ? {
                address: buyer.toLowerCase(),
              } : null,
              price: {
                price: new BigNumber(priceBN.toString())
                  .multipliedBy(new BigNumber(10).pow(offerTokenDecimals))
                  .dividedBy(new BigNumber(amountBN.toString()))
                  .dividedBy(new BigNumber(10).pow(buyerTokenDecimals))
                  .toFixed(18),
                amount: amountBN.toString(),
              },
              availableAmount: amountBN.toString(),
              balance: offerTokenType.toNumber() !== 1 ? {
                amount: balanceAndAllowance.balance,
              } : null,
              allowance: offerTokenType.toNumber() !== 1 ? {
                allowance: balanceAndAllowance.allowance,
              } : null,
              createdAtTimestamp: 0,
              removedAtBlock: null,
            } as any;

            const offer = await parseOffer(
              account,
              offerGraphQl,
              accountUser,
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

            resolve(offer);
          } catch (error) {
            console.error(`Error processing private offer ${offerData.offerId}:`, error);
            reject(error);
          }
        })
    );

    const privateOffers = await Promise.all(promises);
    console.log('Private offers formatted', privateOffers.length);
    return privateOffers;
  } catch (error: any) {
    console.error('Error while fetching private offers via RPC:', error);
    throw error;
  }
};

