import {
  ApolloClient,
  NormalizedCacheObject,
  gql,
} from '@apollo/client';

import BigNumber from 'bignumber.js';
import { Offer as OfferGraphQl } from '../../../gql/graphql';

import { CHAINS, ChainsID } from 'src/constants';
import { PropertiesToken } from 'src/types';
import { DataRealtokenType } from 'src/types/offer/DataRealTokenType';
import { Offer } from 'src/types/offer/Offer';
import { Price } from 'src/types/price';

import { apiClient } from './getClientURL';
import { parseOffer } from './parseOffer';
import { useRootStore } from '../../zustandStore/store';
import { getExtendedTokens } from '../../constants/GetPriceToken';

const nbrFirst = 1000;

export const getBigDataGraphRealtoken = async (
  chainId: number,
  client: ApolloClient<NormalizedCacheObject>,
  realtokenAccount: string[]
) => {
  const chainConfig = CHAINS[chainId as ChainsID];

  const { address: realTokenYamUpgradeable } =
    chainConfig.contracts.realTokenYamUpgradeable;

  const graphNetworkPrefix = chainConfig.graphPrefixes.realtoken;

  // console.log('getBigDataGraphRealtoken', realtokenAccount.length);

  const accountRealtoken: string =
    '"' + realtokenAccount.map((account: string) => account).join('","') + '"';
  //console.log('DEBUG accountRealtoken', accountRealtoken);

  const { data } = await client.query({
    query: gql`
      query getAccountsRealtoken {
        ${graphNetworkPrefix} {
          accountBalances(
            first: ${nbrFirst} 
            where: {amount_gt: "0",id_in: [${accountRealtoken}]}
          ) {
            id
            amount
            allowances(
              where: {spender: "${realTokenYamUpgradeable}"}
            ) {
              allowance
              id
            }
          }
        }
      }
    `,
  });
  //console.log('DEBUG getBigDataGraphRealtoken data', data);

  // Add null check to prevent errors
  if (!data?.[graphNetworkPrefix]?.accountBalances) {
    console.warn(`GraphQL returned null for ${graphNetworkPrefix}.accountBalances, returning empty array`);
    return [];
  }

  const accountBalances = data[graphNetworkPrefix].accountBalances;

  return accountBalances.map((accountBalance: DataRealtokenType) => {
    const allowance: { id: string; allowance: string } | undefined =
      accountBalance.allowances?.find(
        (allowance: { id: string; allowance: string }) =>
          accountBalance.id + '-' + realTokenYamUpgradeable === allowance.id
      );
    /*  console.log(
      'DEBUG data.accountBalances.map allowance',
      allowance,
      data.allowances,
      accountBalance.id + '-' + realTokenYamUpgradeable
    ); */

    return {
      id: accountBalance.id,
      amount: accountBalance.amount,
      allowance: allowance?.allowance ?? '0',
    };
  });
};

/**
 * Fetch offers using TheGraph (default for general market view)
 * RPC is only used for my-offers to reduce load
 */
export const fetchOffersTheGraph = (
  account: string,
  chainId: number,
  propertiesToken: PropertiesToken[],
  wlProperties: number[],
  prices: Price,
  setTheGraphIssue: (value: boolean) => void
): Promise<Offer[]> => {
  // const { abortController } = useRootStore.getState();
  return new Promise<Offer[]>(async (resolve, reject) => {
    try {

      const graphNetworkPrefix = CHAINS[chainId as ChainsID].graphPrefixes.yam;

      const offersData: Offer[] = [];

      const activeOfferResult = await apiClient.query({
        query: gql`
          query {
            ${graphNetworkPrefix}{
              global(id: "1"){
                activeOffersCount
              }
            }
          }
        `,
      });

      // Add null checks to prevent "Cannot read properties of null" errors
      if (!activeOfferResult?.data?.[graphNetworkPrefix]?.global) {
        console.error('GraphQL query returned null for global data:', {
          graphNetworkPrefix,
          data: activeOfferResult?.data,
        });
        reject(new Error(`Failed to fetch active offers count: GraphQL returned null for ${graphNetworkPrefix}.global`));
        return;
      }

      const offersToFetch = activeOfferResult.data[graphNetworkPrefix].global.activeOffersCount;
      console.log('Amount of offersToFetch: ', offersToFetch);
      
      if (!offersToFetch || offersToFetch === 0) {
        console.log('No active offers found');
        resolve([]);
        return;
      }

      const offersRes = await apiClient.query({
        query: gql`
          query {
            ${graphNetworkPrefix} {
              offers (first: ${offersToFetch}, where: { removedAtBlock: null }) {
                id
                seller {
                    id
                    address
                }
                allowance {
                    allowance
                }
                balance {
                    amount
                }
                offerToken {
                    address
                    name
                    decimals
                    symbol
                    tokenType
                }
                price {
                    price
                    amount
                }
                buyerToken {
                    name
                    symbol
                    address
                    decimals
                    tokenType
                }
                buyer {
                    address
                }
                removedAtBlock
                availableAmount
                createdAtTimestamp
              }
            }
          }
        `,
      })

      // Add null check for offers data
      if (!offersRes?.data?.[graphNetworkPrefix]?.offers) {
        console.error('GraphQL query returned null for offers data:', {
          graphNetworkPrefix,
          data: offersRes?.data,
        });
        reject(new Error(`Failed to fetch offers: GraphQL returned null for ${graphNetworkPrefix}.offers`));
        return;
      }

      const offers: OfferGraphQl[] = offersRes.data[graphNetworkPrefix].offers;
      console.log('offers: ', offers.length)

      const accountRealtokenDuplicates: string[] = offers.map(
        (val) => val.seller.address + '-' + val.offerToken.address
      );
      const accountBalanceId = [...new Set(accountRealtokenDuplicates)]; // remove duplicates

      const bigDataRealTokenPromises = [];
      for (let i = 0; i < accountBalanceId.length; i += nbrFirst) {
        const batch: string[] = accountBalanceId.slice(i, i + nbrFirst);
        if (batch.length <= 0) break;

        bigDataRealTokenPromises.push(
          getBigDataGraphRealtoken(chainId, apiClient, batch)
        );
      }

      const dataRealtoken = (
        await Promise.all(bigDataRealTokenPromises)
      ).flat() as DataRealtokenType[];

      const extendedTokensAddress = getExtendedTokens(chainId).map((token) => token.contractAddress);

      const promises = offers.map(
        (offer: OfferGraphQl) =>
          new Promise<Offer>(async (resolve, reject) => {
            try {
              const accountUserRealtoken: DataRealtokenType | undefined =
                dataRealtoken.find(
                  (accountBalance: DataRealtokenType): boolean =>
                    accountBalance.id ===
                    offer.seller.address + '-' + offer.offerToken.address
                );

              // Provide default values if accountUserRealtoken is not found
              const defaultAccountRealtoken: DataRealtokenType = {
                id: offer.seller.address + '-' + offer.offerToken.address,
                amount: '0',
                allowance: '0',
              };

              const offerData: Offer = await parseOffer(
                account,
                offer,
                accountUserRealtoken || defaultAccountRealtoken,
                propertiesToken,
                wlProperties,
                prices,
                extendedTokensAddress
              );

              offerData.hasPropertyToken =
                BigNumber(offerData.buyerTokenType).eq(1) ||
                BigNumber(offerData.offerTokenType).eq(1);

              resolve(offerData);
            } catch (err) {
              console.log('Error when parsingOffer: ', err);
              reject(err);
            }
          })
      );

      const parsedOffers = await Promise.all(promises);
      console.log('Offers formated', parsedOffers.length);

      // ERROR_RANGE is used to check if the number of offers fetched is correctly
      const ERROR_RANGE = 0.1;
      if(parsedOffers.length < offersToFetch*(1-ERROR_RANGE)) {
        setTheGraphIssue(true);
      }

      offersData.push(...parsedOffers);

      resolve(offersData);
    } catch (err) {
      console.log('Error while fetching offers from TheGraph', err);
      reject(err);
    }
  });
};
