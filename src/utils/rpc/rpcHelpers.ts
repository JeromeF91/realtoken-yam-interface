import { JsonRpcProvider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import { CHAINS, ChainsID } from '../../constants';
import { erc20ABI } from '../../abis';
import { Erc20 } from '../../abis/types/Erc20';
import BigNumber from 'bignumber.js';

/**
 * Get an RPC provider for a given chain
 */
export const getRpcProvider = (chainId: number): JsonRpcProvider => {
  const chain = CHAINS[chainId as ChainsID];
  if (!chain) {
    throw new Error(`Unsupported chainId: ${chainId}`);
  }
  return new JsonRpcProvider(chain.rpcUrl);
};

/**
 * Get an ERC20 contract instance
 */
export const getERC20Contract = (
  tokenAddress: string,
  provider: JsonRpcProvider
): Erc20 => {
  return new Contract(tokenAddress, erc20ABI, provider) as Erc20;
};

/**
 * Get token balance for an address
 */
export const getTokenBalance = async (
  tokenAddress: string,
  ownerAddress: string,
  provider: JsonRpcProvider
): Promise<string> => {
  const contract = getERC20Contract(tokenAddress, provider);
  const balance = await contract.balanceOf(ownerAddress);
  return balance.toString();
};

/**
 * Get token allowance
 */
export const getTokenAllowance = async (
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  provider: JsonRpcProvider
): Promise<string> => {
  const contract = getERC20Contract(tokenAddress, provider);
  const allowance = await contract.allowance(ownerAddress, spenderAddress);
  return allowance.toString();
};

/**
 * Get token info (decimals, name, symbol)
 */
export const getTokenInfo = async (
  tokenAddress: string,
  provider: JsonRpcProvider
): Promise<{ decimals: number; name: string; symbol: string }> => {
  const contract = getERC20Contract(tokenAddress, provider);
  const [decimals, name, symbol] = await Promise.all([
    contract.decimals(),
    contract.name(),
    contract.symbol(),
  ]);
  return {
    decimals,
    name,
    symbol,
  };
};

/**
 * Get multiple token balances in parallel
 */
export const getTokenBalances = async (
  tokenAddresses: string[],
  ownerAddress: string,
  provider: JsonRpcProvider
): Promise<Record<string, string>> => {
  const balances: Record<string, string> = {};
  
  // Batch requests in chunks to avoid overwhelming the RPC
  const chunkSize = 50;
  for (let i = 0; i < tokenAddresses.length; i += chunkSize) {
    const chunk = tokenAddresses.slice(i, i + chunkSize);
    const promises = chunk.map(async (tokenAddress) => {
      try {
        const balance = await getTokenBalance(tokenAddress, ownerAddress, provider);
        return { tokenAddress, balance };
      } catch (error) {
        console.error(`Error fetching balance for ${tokenAddress}:`, error);
        return { tokenAddress, balance: '0' };
      }
    });
    
    const results = await Promise.all(promises);
    results.forEach(({ tokenAddress, balance }) => {
      balances[tokenAddress.toLowerCase()] = balance;
    });
  }
  
  return balances;
};

/**
 * Get multiple token allowances in parallel
 */
export const getTokenAllowances = async (
  tokenAddresses: string[],
  ownerAddress: string,
  spenderAddress: string,
  provider: JsonRpcProvider
): Promise<Record<string, string>> => {
  const allowances: Record<string, string> = {};
  
  // Batch requests in chunks
  const chunkSize = 50;
  for (let i = 0; i < tokenAddresses.length; i += chunkSize) {
    const chunk = tokenAddresses.slice(i, i + chunkSize);
    const promises = chunk.map(async (tokenAddress) => {
      try {
        const allowance = await getTokenAllowance(
          tokenAddress,
          ownerAddress,
          spenderAddress,
          provider
        );
        return { tokenAddress, allowance };
      } catch (error) {
        console.error(`Error fetching allowance for ${tokenAddress}:`, error);
        return { tokenAddress, allowance: '0' };
      }
    });
    
    const results = await Promise.all(promises);
    results.forEach(({ tokenAddress, allowance }) => {
      allowances[tokenAddress.toLowerCase()] = allowance;
    });
  }
  
  return allowances;
};

/**
 * Get balance and allowance for a token
 */
export const getTokenBalanceAndAllowance = async (
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  provider: JsonRpcProvider
): Promise<{ balance: string; allowance: string }> => {
  const [balance, allowance] = await Promise.all([
    getTokenBalance(tokenAddress, ownerAddress, provider),
    getTokenAllowance(tokenAddress, ownerAddress, spenderAddress, provider),
  ]);
  return { balance, allowance };
};

