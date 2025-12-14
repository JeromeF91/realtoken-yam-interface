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
import { fetchOffersRpc } from '../rpc/fetchOffersRpc';

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
 * Fetch offers using RPC calls instead of TheGraph
 * This is the main entry point - it uses the RPC implementation
 */
export const fetchOffersTheGraph = (
  account: string,
  chainId: number,
  propertiesToken: PropertiesToken[],
  wlProperties: number[],
  prices: Price,
  setTheGraphIssue: (value: boolean) => void
): Promise<Offer[]> => {
  // Use RPC implementation instead of TheGraph
  return fetchOffersRpc(
    account,
    chainId,
    propertiesToken,
    wlProperties,
    prices,
    setTheGraphIssue
  );
};
