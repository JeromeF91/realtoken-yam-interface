import { JsonRpcProvider, Web3Provider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
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

/**
 * Fetch a single offer using RPC calls instead of TheGraph
 */
export const fetchOfferRpc = async (
  provider: Web3Provider | JsonRpcProvider,
  account: string,
  chainId: number,
  offerId: number,
  propertiesToken: PropertiesToken[],
  wlProperties: number[],
  prices: Price
): Promise<Offer | undefined> => {
  try {
    // Always use JsonRpcProvider for read-only calls to avoid signer issues
    const rpcProvider = getRpcProvider(chainId);
    
    const chainConfig = CHAINS[chainId as ChainsID];
    const { address: yamContractAddress } = chainConfig.contracts.realTokenYamUpgradeable;

    // Get YAM contract instance
    const yamContract = new Contract(
      yamContractAddress,
      realTokenYamUpgradeableABI,
      rpcProvider
    ) as RealTokenYamUpgradeable;

    // Fetch offer data from contract using callStatic to ensure it's a read-only call
    let offerData;
    try {
      offerData = await yamContract.callStatic.showOffer(offerId);
    } catch (error: any) {
      // Handle call revert exceptions (e.g., offer doesn't exist or was removed)
      if (error?.code === 'CALL_EXCEPTION' || 
          error?.message?.includes('revert') || 
          error?.error?.code === 'CALL_EXCEPTION' ||
          error?.error?.code === -32000) {
        console.warn(`Offer ${offerId} does not exist or was removed.`);
        return undefined;
      }
      // Re-throw unexpected errors
      throw error;
    }
    
    // showOffer returns: [seller, offerToken, buyerToken, buyer, price, amount]
    const [seller, offerTokenAddress, buyerTokenAddress, buyer, priceBN, amountBN] = offerData;

    // Get token info for both tokens
    const [offerTokenInfo, buyerTokenInfo] = await Promise.all([
      yamContract.tokenInfo(offerTokenAddress),
      yamContract.tokenInfo(buyerTokenAddress),
    ]);

    // tokenInfo returns: [tokenType, name, symbol]
    const [offerTokenType, offerTokenName, offerTokenSymbol] = offerTokenInfo;
    const [buyerTokenType, buyerTokenName, buyerTokenSymbol] = buyerTokenInfo;

    // Get token decimals from ERC20 contracts
    const [offerTokenDecimals, buyerTokenDecimals] = await Promise.all([
      getTokenInfo(offerTokenAddress, rpcProvider).then(info => info.decimals),
      getTokenInfo(buyerTokenAddress, rpcProvider).then(info => info.decimals),
    ]);

    // Get balance and allowance
    const balanceAndAllowance = await getTokenBalanceAndAllowance(
      offerTokenAddress,
      seller,
      yamContractAddress,
      rpcProvider
    );

    // Calculate available amount
    const availableAmount = Math.min(
      Number(amountBN.toString()),
      Number(balanceAndAllowance.balance),
      Number(balanceAndAllowance.allowance)
    ).toString();

    // Create account user realtoken data
    const accountUser: DataRealtokenType = {
      id: `${seller.toLowerCase()}-${offerTokenAddress.toLowerCase()}`,
      amount: balanceAndAllowance.balance,
      allowance: balanceAndAllowance.allowance,
    };

    // Create a GraphQL-like offer structure for parseOffer
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
        price: priceBN.toString(),
        amount: amountBN.toString(),
      },
      availableAmount: availableAmount,
      balance: offerTokenType.toNumber() !== 1 ? {
        amount: balanceAndAllowance.balance,
      } : null,
      allowance: offerTokenType.toNumber() !== 1 ? {
        allowance: balanceAndAllowance.allowance,
      } : null,
      createdAtTimestamp: 0, // TODO: Get from events if needed
      removedAtBlock: null,
    } as any;

    const extendedTokensAddress = getExtendedTokens(chainId).map((token) => token.contractAddress);

    // Parse the offer using the existing parseOffer function
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

    return offer;
  } catch (error) {
    console.error('Error fetching offer via RPC:', error);
    return undefined;
  }
};

