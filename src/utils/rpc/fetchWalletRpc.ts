import { JsonRpcProvider } from '@ethersproject/providers';
import { Account } from '../../types/Account';
import { CHAINS, ChainsID } from '../../constants';
import { getRpcProvider, getTokenBalance, getTokenAllowance } from './rpcHelpers';

/**
 * Fetch wallet balance and allowance using RPC calls instead of TheGraph
 */
export const fetchWalletRpc = async (
  address: string,
  offerTokenAddress: string,
  chainId: number
): Promise<Account> => {
  try {
    const provider = getRpcProvider(chainId);
    const { address: realTokenYamUpgradeable } =
      CHAINS[chainId as ChainsID].contracts.realTokenYamUpgradeable;

    // Fetch balance and allowance in parallel
    const [balanceStr, allowanceStr] = await Promise.all([
      getTokenBalance(offerTokenAddress, address, provider),
      getTokenAllowance(offerTokenAddress, address, realTokenYamUpgradeable, provider),
    ]);

    const account: Account = {
      balance: parseFloat(balanceStr) || 0,
      allowance: parseFloat(allowanceStr) || 0,
    };

    return account;
  } catch (error) {
    console.error('Error fetching wallet via RPC:', error);
    // Return zero values on error
    return {
      balance: 0,
      allowance: 0,
    };
  }
};

