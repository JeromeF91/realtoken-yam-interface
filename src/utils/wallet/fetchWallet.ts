// @ts-nocheck

import { Account } from 'src/types/Account';
import { fetchWalletRpc } from '../rpc/fetchWalletRpc';

/**
 * Fetch wallet balance and allowance using RPC calls
 * This replaces the previous TheGraph implementation
 */
export const fetchWallet = (
  address: string,
  offerTokenAddress: string,
  chainId: number
) => {
  return new Promise<Account>(async (resolve, reject) => {
    try {
      const account = await fetchWalletRpc(address, offerTokenAddress, chainId);
      resolve(account);
    } catch (err) {
      console.log('Error fetching wallet:', err);
      reject(err);
    }
  });
};
