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
    // Validate chainId - ensure it's a valid ChainsID
    // ChainsID enum values: Ethereum = 0x01 (1), Gnosis = 0x64 (100), Sepolia = 0xaa36a7 (11155111)
    const validChainIds = [ChainsID.Ethereum, ChainsID.Gnosis, ChainsID.Sepolia];
    const chainIdNumber = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;
    
    if (!chainIdNumber || !validChainIds.includes(chainIdNumber as ChainsID)) {
      console.error(`Invalid or unsupported chainId: ${chainId} (as number: ${chainIdNumber}). Valid chainIds are:`, validChainIds.map(id => `${id} (0x${id.toString(16)})`));
      throw new Error(`Unsupported chainId: ${chainId}. Please switch to a supported chain (Gnosis=100 or Ethereum=1).`);
    }
    
    // Use the numeric chainId
    const finalChainId = chainIdNumber;
    
    // Always use JsonRpcProvider for read-only calls to avoid signer issues
    const rpcProvider = getRpcProvider(finalChainId);
    
    const chainConfig = CHAINS[finalChainId as ChainsID];
    if (!chainConfig) {
      throw new Error(`Chain configuration not found for chainId: ${finalChainId}`);
    }
    
    const { address: yamContractAddress } = chainConfig.contracts.realTokenYamUpgradeable;
    console.log(`Fetching offer ${offerId} on chain ${finalChainId} (${chainConfig.chainName}) using RPC: ${chainConfig.rpcUrl}, contract: ${yamContractAddress}`);
    
    // Verify the provider's network matches
    try {
      const providerNetwork = await rpcProvider.getNetwork();
      if (providerNetwork.chainId !== finalChainId) {
        console.warn(`Provider network chainId (${providerNetwork.chainId}) doesn't match requested chainId (${finalChainId})`);
      }
    } catch (networkError) {
      console.warn('Could not verify provider network:', networkError);
    }

    // Get YAM contract instance
    const yamContract = new Contract(
      yamContractAddress,
      realTokenYamUpgradeableABI,
      rpcProvider
    ) as RealTokenYamUpgradeable;

    // Check total offer count first to validate the offer ID
    try {
      const offerCountBN = await yamContract.callStatic.getOfferCount();
      const offerCount = offerCountBN.toNumber();
      console.log(`Total offers on chain ${finalChainId}: ${offerCount}`);
      
      if (offerId >= offerCount) {
        console.warn(`Offer ID ${offerId} is out of range. Total offers: ${offerCount}`);
        throw new Error(`Offer ID ${offerId} is out of range. There are only ${offerCount} offers on this chain.`);
      }
    } catch (countError: any) {
      // If getOfferCount fails, log but continue (might be a network issue)
      console.warn('Could not get offer count:', countError);
    }

    // Fetch offer data from contract - use callStatic for read-only calls (no signer needed)
    let offerData;
    try {
      console.log(`Attempting to call showOffer(${offerId}) on contract ${yamContractAddress}...`);
      // Use callStatic to ensure it's a read-only call (no signer required)
      // This matches the yambyofferid.netlify.app behavior when using JsonRpcProvider
      offerData = await yamContract.callStatic.showOffer(offerId);
      console.log(`Successfully fetched offer ${offerId}:`, offerData);
    } catch (error: any) {
      console.error(`Error calling showOffer(${offerId}):`, {
        code: error?.code,
        message: error?.message,
        error: error?.error,
        data: error?.data,
        transaction: error?.transaction,
        stack: error?.stack,
      });
      
      // Handle call revert exceptions (e.g., offer doesn't exist or was removed)
      if (error?.code === 'CALL_EXCEPTION' || 
          error?.message?.includes('revert') || 
          error?.error?.code === 'CALL_EXCEPTION' ||
          error?.error?.code === -32000 ||
          error?.error?.message?.includes('execution reverted')) {
        console.warn(`Offer ${offerId} does not exist or was removed on chain ${finalChainId} (${chainConfig.chainName}).`);
        console.warn(`Contract address: ${yamContractAddress}, RPC: ${chainConfig.rpcUrl}`);
        return undefined;
      }
      // Re-throw unexpected errors
      throw error;
    }
    
    // showOffer returns: [seller, offerToken, buyerToken, buyer, price, amount]
    const [seller, offerTokenAddress, buyerTokenAddress, buyer, priceBN, amountBN] = offerData;

    // Get token info - try tokenInfo first, but fallback to ERC20 if it fails
    // This is critical - if tokenInfo fails, we should still be able to display the offer
    let offerTokenInfo, buyerTokenInfo;
    
    const getTokenInfoWithFallback = async (tokenAddress: string, tokenName: string) => {
      try {
        // Try tokenInfo first (works for whitelisted tokens)
        const info = await yamContract.callStatic.tokenInfo(tokenAddress);
        console.log(`Successfully fetched ${tokenName} via tokenInfo`);
        return info;
      } catch (error: any) {
        console.warn(`tokenInfo failed for ${tokenName} ${tokenAddress}, using ERC20 fallback:`, error?.message);
        // Fallback: get token info directly from ERC20 contract
        try {
          const erc20Info = await getTokenInfo(tokenAddress, rpcProvider);
          // Try to get tokenType from contract
          let tokenType = 3; // Default to ERC20
          try {
            const tokenTypeBN = await yamContract.callStatic.getTokenType(tokenAddress);
            tokenType = tokenTypeBN.toNumber();
          } catch (e) {
            console.warn(`Could not get tokenType for ${tokenName}, using default 3`);
          }
          // Return in tokenInfo format: [tokenType, name, symbol]
          return [
            { toNumber: () => tokenType } as any,
            erc20Info.name,
            erc20Info.symbol,
          ];
        } catch (erc20Error: any) {
          console.error(`Failed to get ERC20 info for ${tokenName} ${tokenAddress}:`, erc20Error);
          // Last resort: return minimal info
          return [
            { toNumber: () => 3 } as any,
            'Unknown Token',
            'UNKNOWN',
          ];
        }
      }
    };
    
    // Fetch both token infos in parallel with fallback handling
    try {
      [offerTokenInfo, buyerTokenInfo] = await Promise.all([
        getTokenInfoWithFallback(offerTokenAddress, 'offerToken'),
        getTokenInfoWithFallback(buyerTokenAddress, 'buyerToken'),
      ]);
    } catch (error: any) {
      console.error('Critical error fetching token info:', error);
      // Don't fail completely - we can still show the offer with basic info
      throw new Error(`Failed to fetch token information: ${error?.message}`);
    }

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
  } catch (error: any) {
    console.error('Error fetching offer via RPC:', error);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
      error: error?.error,
    });
    // Don't return undefined for unexpected errors - throw so we can see what's wrong
    if (error?.message?.includes('token information')) {
      // This is a known error we're handling
      return undefined;
    }
    // Re-throw to see the actual error
    throw error;
  }
};

