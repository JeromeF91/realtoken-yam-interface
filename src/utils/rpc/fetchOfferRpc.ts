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
import BigNumber from 'bignumber.js';

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
    
    // Try to reuse the existing provider if it's a JsonRpcProvider and matches the chainId
    // Otherwise, get a cached JsonRpcProvider to avoid eth_chainId calls
    let rpcProvider: JsonRpcProvider;
    if (provider instanceof JsonRpcProvider) {
      // Check if the provider's network matches (without calling getNetwork which triggers eth_chainId)
      // We'll trust the chainId passed in and use the cached provider
      rpcProvider = getRpcProvider(finalChainId);
    } else {
      // For Web3Provider, always use cached JsonRpcProvider to avoid signer issues
      rpcProvider = getRpcProvider(finalChainId);
    }
    
    const chainConfig = CHAINS[finalChainId as ChainsID];
    if (!chainConfig) {
      throw new Error(`Chain configuration not found for chainId: ${finalChainId}`);
    }
    
    const { address: yamContractAddress } = chainConfig.contracts.realTokenYamUpgradeable;
    // Provider is already configured with explicit chainId, no need to verify via getNetwork()

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
    // BUT: Based on actual contract return values, it appears the order might be different
    // Log the raw return values to verify the order
    console.log('showOffer raw return values:', {
      value0: offerData[0],
      value1: offerData[1],
      value2: offerData[2],
      value3: offerData[3],
      value4: offerData[4]?.toString(),
      value5: offerData[5]?.toString(),
      allValues: offerData,
    });
    
    // Based on actual contract return values from the user's test:
    // value0: '0x0643FFB30aDD44eF5c74996AD57A03A2244b6F28' - offerToken address
    // value1: '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83' - buyerToken address  
    // value2: '0x540A623c7ed0c09E1B3916A83d93f2F59d44eA89' - seller wallet address
    // value3: '0x0000000000000000000000000000000000000000' - buyer address (zero for public)
    // value4: price (BigNumber)
    // value5: amount (BigNumber)
    //
    // So the actual order is: [offerToken, buyerToken, seller, buyer, price, amount]
    // NOT: [seller, offerToken, buyerToken, buyer, price, amount] as the comment suggests
    const [offerTokenAddress, buyerTokenAddress, seller, buyer, priceBN, amountBN] = offerData;
    
    console.log('Using corrected order: [offerToken, buyerToken, seller, buyer, price, amount]');
    
    // Log the destructured values to verify they're correct
    console.log('Destructured showOffer values:', {
      seller,
      offerTokenAddress,
      buyerTokenAddress,
      buyer,
      priceBN: priceBN?.toString(),
      amountBN: amountBN?.toString(),
    });

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
          console.warn(`Failed to get ERC20 info for ${tokenName} ${tokenAddress} (may not be ERC20 or contract may not exist):`, erc20Error?.message);
          // Last resort: return minimal info with address as identifier
          // Try to get tokenType from contract even if ERC20 fails
          let tokenType = 3; // Default to ERC20
          try {
            const tokenTypeBN = await yamContract.callStatic.getTokenType(tokenAddress);
            tokenType = tokenTypeBN.toNumber();
          } catch (e) {
            // If getTokenType also fails, it's likely not a valid token contract
            console.warn(`Could not get tokenType for ${tokenName}, using default 3`);
          }
          // Use address as identifier if we can't get name/symbol
          const addressShort = `${tokenAddress.substring(0, 6)}...${tokenAddress.substring(38)}`;
          return [
            { toNumber: () => tokenType } as any,
            `Token ${addressShort}`,
            addressShort.toUpperCase(),
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

    // Get token decimals from ERC20 contracts (with fallback for non-ERC20 tokens)
    const [offerTokenDecimals, buyerTokenDecimals] = await Promise.all([
      getTokenInfo(offerTokenAddress, rpcProvider)
        .then(info => {
          console.log(`Fetched decimals for offerToken ${offerTokenAddress}: ${info.decimals}`);
          return info.decimals;
        })
        .catch((error) => {
          console.warn(`Could not get decimals for offerToken ${offerTokenAddress}, using default 18:`, error?.message);
          return 18; // Default to 18 decimals
        }),
      getTokenInfo(buyerTokenAddress, rpcProvider)
        .then(info => {
          console.log(`Fetched decimals for buyerToken ${buyerTokenAddress}: ${info.decimals}`);
          return info.decimals;
        })
        .catch((error) => {
          console.warn(`Could not get decimals for buyerToken ${buyerTokenAddress}, using default 18:`, error?.message);
          return 18; // Default to 18 decimals
        }),
    ]);
    
    console.log('Token decimals:', {
      offerTokenAddress,
      offerTokenDecimals,
      buyerTokenAddress,
      buyerTokenDecimals,
    });

    // Get balance and allowance
    // IMPORTANT: seller should be the wallet address, not the token address
    // Verify that seller is not the same as offerTokenAddress
    if (seller.toLowerCase() === offerTokenAddress.toLowerCase()) {
      console.error('ERROR: seller address matches offerTokenAddress! This indicates the return order might be wrong.');
      console.error('seller:', seller);
      console.error('offerTokenAddress:', offerTokenAddress);
      console.error('buyerTokenAddress:', buyerTokenAddress);
      console.error('buyer:', buyer);
    }
    
    console.log('Fetching balance and allowance for:', {
      tokenAddress: offerTokenAddress,
      ownerAddress: seller,
      spenderAddress: yamContractAddress,
    });
    
    const balanceAndAllowance = await getTokenBalanceAndAllowance(
      offerTokenAddress,
      seller,
      yamContractAddress,
      rpcProvider
    );

    console.log('Balance and Allowance (raw):', {
      balance: balanceAndAllowance.balance,
      allowance: balanceAndAllowance.allowance,
      amountBN: amountBN.toString(),
      offerTokenAddress,
      seller,
      yamContractAddress,
      offerTokenDecimals,
    });

    // Format balance and allowance with decimals for logging
    const balanceFormatted = new BigNumber(balanceAndAllowance.balance)
      .shiftedBy(-offerTokenDecimals)
      .toFixed(6);
    const allowanceFormatted = new BigNumber(balanceAndAllowance.allowance)
      .shiftedBy(-offerTokenDecimals)
      .toFixed(6);
    const amountFormatted = new BigNumber(amountBN.toString())
      .shiftedBy(-offerTokenDecimals)
      .toFixed(6);
    
    console.log('Balance and Allowance (formatted):', {
      balance: balanceFormatted,
      allowance: allowanceFormatted,
      amount: amountFormatted,
    });

    // Calculate available amount (use the minimum of amount, balance, and allowance)
    const availableAmount = Math.min(
      Number(amountBN.toString()),
      Number(balanceAndAllowance.balance),
      Number(balanceAndAllowance.allowance)
    ).toString();
    
    console.log('Calculated availableAmount:', availableAmount);

    // Create account user realtoken data
    // Always set balance and allowance, regardless of token type
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
        // The contract returns: priceBN = price per token
        // The price is in the buyerToken's decimals, but if the offerToken is USDC,
        // the price might be in USDC decimals (6) instead of buyerToken decimals
        // We need to determine which decimals to use based on the token types
        price: (() => {
          // The contract returns priceBN in the smallest units
          // If offerToken is USDC (6 decimals), priceBN is in USDC decimals (6)
          // If buyerToken is USDC (6 decimals), priceBN is in USDC decimals (6)
          // Otherwise, priceBN is in buyerToken decimals (usually 18)
          let decimalsToUse = buyerTokenDecimals;
          
          // Check if offerToken is USDC (check decimals first, then name/symbol)
          const isOfferTokenUSDC = offerTokenDecimals === 6 || 
                                   (offerTokenName && offerTokenName.toUpperCase().includes('USDC')) ||
                                   (offerTokenSymbol && offerTokenSymbol.toUpperCase().includes('USDC'));
          
          // Check if buyerToken is USDC
          const isBuyerTokenUSDC = buyerTokenDecimals === 6 || 
                                   (buyerTokenName && buyerTokenName.toUpperCase().includes('USDC')) ||
                                   (buyerTokenSymbol && buyerTokenSymbol.toUpperCase().includes('USDC'));
          
          console.log('USDC detection:', {
            offerTokenName,
            offerTokenSymbol,
            offerTokenDecimals,
            isOfferTokenUSDC,
            buyerTokenName,
            buyerTokenSymbol,
            buyerTokenDecimals,
            isBuyerTokenUSDC,
          });
          
          // If offerToken is USDC, priceBN is in USDC decimals (6)
          // If buyerToken is USDC, priceBN is in USDC decimals (6)
          // Otherwise, use buyerToken decimals
          if (isOfferTokenUSDC) {
            decimalsToUse = 6;
            console.log('✓ Using 6 decimals for priceBN because offerToken is USDC');
          } else if (isBuyerTokenUSDC) {
            decimalsToUse = 6;
            console.log('✓ Using 6 decimals for priceBN because buyerToken is USDC');
          } else {
            console.log(`Using buyerToken decimals (${buyerTokenDecimals}) for priceBN`);
          }
          
          // priceBN is already the price per token, normalize by the appropriate decimals
          const pricePerUnit = new BigNumber(priceBN.toString()).dividedBy(new BigNumber(10).pow(decimalsToUse));
          
          console.log('Price calculation result:', {
            priceBN: priceBN.toString(),
            amountBN: amountBN.toString(),
            offerTokenName,
            offerTokenSymbol,
            offerTokenDecimals,
            buyerTokenName,
            buyerTokenSymbol,
            buyerTokenDecimals,
            decimalsToUse,
            pricePerUnit: pricePerUnit.toString(),
            pricePerUnitFixed: pricePerUnit.toFixed(6),
            pricePerUnitUSD: pricePerUnit.toFixed(2),
          });
          
          return pricePerUnit.toString();
        })(),
        amount: amountBN.toString(),
      },
      availableAmount: amountBN.toString(), // Use the full amount from the contract - parseOffer will calculate the actual available amount
      // Always set balance and allowance for ERC20 tokens (type 2 or 3)
      // For type 1 (RealToken), parseOffer will use accountUserRealtoken instead
      balance: offerTokenType.toNumber() !== 1 ? {
        amount: balanceAndAllowance.balance,
      } : null,
      allowance: offerTokenType.toNumber() !== 1 ? {
        allowance: balanceAndAllowance.allowance,
      } : null,
      createdAtTimestamp: 0, // TODO: Get from events if needed
      removedAtBlock: null,
    } as any;
    
    console.log('Offer GraphQL structure:', {
      id: offerGraphQl.id,
      price: offerGraphQl.price.price,
      amount: offerGraphQl.price.amount,
      availableAmount: offerGraphQl.availableAmount,
      balance: offerGraphQl.balance?.amount,
      allowance: offerGraphQl.allowance?.allowance,
      offerTokenDecimals: offerGraphQl.offerToken.decimals,
      buyerTokenDecimals: offerGraphQl.buyerToken.decimals,
      offerTokenName: offerGraphQl.offerToken.name,
      offerTokenSymbol: offerGraphQl.offerToken.symbol,
      // Calculate formatted amounts for debugging
      availableAmountFormatted: new BigNumber(offerGraphQl.availableAmount)
        .shiftedBy(-Number(offerGraphQl.offerToken.decimals))
        .toFixed(6),
    });

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

