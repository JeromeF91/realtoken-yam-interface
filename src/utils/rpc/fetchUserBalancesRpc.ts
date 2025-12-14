import { JsonRpcProvider } from '@ethersproject/providers';
import { UserBalances } from '../../types/UserBalance';
import { getRpcProvider, getTokenBalances } from './rpcHelpers';
import BigNumber from 'bignumber.js';

/**
 * Fetch user balances for all tokens using RPC calls
 * Note: This requires knowing which tokens to check. 
 * In the original implementation, this came from TheGraph.
 * We'll need to get the token list from properties or another source.
 */
export const fetchUserBalancesRpc = async (
  account: string,
  chainId: number,
  tokenAddresses: string[]
): Promise<UserBalances> => {
  try {
    const provider = getRpcProvider(chainId);
    
    // Fetch balances for all tokens in parallel (with batching)
    const balances = await getTokenBalances(tokenAddresses, account, provider);
    
    // Convert to UserBalances format (BigNumber values)
    const userBalances: UserBalances = {};
    Object.entries(balances).forEach(([tokenAddress, balance]) => {
      userBalances[tokenAddress.toLowerCase()] = new BigNumber(balance);
    });
    
    return userBalances;
  } catch (error) {
    console.error('Error fetching user balances via RPC:', error);
    return {};
  }
};

