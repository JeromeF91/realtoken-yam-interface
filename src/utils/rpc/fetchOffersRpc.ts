import { JsonRpcProvider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import BigNumber from 'bignumber.js';
import { CHAINS, ChainsID } from '../../constants';
import { realTokenYamUpgradeableABI } from '../../abis';
import { RealTokenYamUpgradeable } from '../../abis/types/RealTokenYamUpgradeable';
import { getRpcProvider, getTokenInfo, getTokenBalanceAndAllowance } from './rpcHelpers';
import { Offer } from '../../types/offer/Offer';
import { PropertiesToken } from '../../types';
import { Price } from '../../types/price';
import { DataRealtokenType } from '../../types/offer/DataRealTokenType';
import { parseOffer } from '../offers/parseOffer';
import { getExtendedTokens } from '../../constants/GetPriceToken';

/**
 * Fetch offers using RPC calls instead of TheGraph
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

    // Fetch all offers in parallel (with batching to avoid overwhelming RPC)
    const batchSize = 50;
    const offers: Offer[] = [];
    const accountRealtokenMap = new Map<string, DataRealtokenType>();

    for (let i = 0; i < offerCount; i += batchSize) {
      const batchEnd = Math.min(i + batchSize, offerCount);
      const batchPromises: Promise<void>[] = [];

      for (let offerId = i; offerId < batchEnd; offerId++) {
        batchPromises.push(
          (async () => {
            try {
              // Fetch offer data from contract
              const offerData = await yamContract.showOffer(offerId);
              // showOffer returns: [seller, offerToken, buyerToken, buyer, price, amount]
              const [seller, offerTokenAddress, buyerTokenAddress, buyer, priceBN, amountBN] = offerData;

              // Check if offer is removed (we'll need to check events for this, but for now assume not removed)
              // TODO: Check removedAtBlock from events if needed

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
                getTokenInfo(offerTokenAddress, provider).then(info => info.decimals),
                getTokenInfo(buyerTokenAddress, provider).then(info => info.decimals),
              ]);

              // Get balance and allowance for offer token if it's a RealToken (type 1)
              // For ERC20 tokens, we'll need to fetch separately
              let balance = '0';
              let allowance = '0';
              const accountKey = `${seller.toLowerCase()}-${offerTokenAddress.toLowerCase()}`;

              if (offerTokenType.toNumber() === 1) {
                // RealToken - get from accountRealtokenMap or fetch
                if (!accountRealtokenMap.has(accountKey)) {
                  const { address: yamAddress } = chainConfig.contracts.realTokenYamUpgradeable;
                  const balanceAndAllowance = await getTokenBalanceAndAllowance(
                    offerTokenAddress,
                    seller,
                    yamAddress,
                    provider
                  );
                  accountRealtokenMap.set(accountKey, {
                    id: accountKey,
                    amount: balanceAndAllowance.balance,
                    allowance: balanceAndAllowance.allowance,
                  });
                }
                const accountData = accountRealtokenMap.get(accountKey)!;
                balance = accountData.amount;
                allowance = accountData.allowance;
              } else {
                // ERC20 token - fetch balance and allowance
                const { address: yamAddress } = chainConfig.contracts.realTokenYamUpgradeable;
                const balanceAndAllowance = await getTokenBalanceAndAllowance(
                  offerTokenAddress,
                  seller,
                  yamAddress,
                  provider
                );
                balance = balanceAndAllowance.balance;
                allowance = balanceAndAllowance.allowance;
              }

              // Calculate available amount (minimum of amount, balance, allowance)
              const availableAmount = BigNumber.minimum(
                amountBN.toString(),
                balance,
                allowance
              ).toString();

              // Create a GraphQL-like offer structure for parseOffer
              // We need to adapt this to match the OfferGraphQl type
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
                  amount: balance,
                } : null,
                allowance: offerTokenType.toNumber() !== 1 ? {
                  allowance: allowance,
                } : null,
                createdAtTimestamp: 0, // TODO: Get from events if needed
                removedAtBlock: null,
              } as any;

              const accountUserRealtoken = accountRealtokenMap.get(accountKey);
              const extendedTokensAddress = getExtendedTokens(chainId).map((token) => token.contractAddress);

              // Parse the offer using the existing parseOffer function
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
              console.error(`Error fetching offer ${offerId}:`, error);
              // Continue with other offers
            }
          })()
        );
      }

      await Promise.all(batchPromises);
    }

    console.log('Offers formated', offers.length);

    // Check if we got significantly fewer offers than expected (TheGraph issue detection)
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

