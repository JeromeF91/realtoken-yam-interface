import { JsonRpcProvider } from '@ethersproject/providers';
import { Contract, Interface } from '@ethersproject/contracts';

/**
 * Multicall3 contract addresses (same address on all chains)
 * Multicall3: https://github.com/mds1/multicall
 */
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

/**
 * Multicall3 ABI (simplified - only what we need)
 */
const MULTICALL3_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'target', type: 'address' },
          { name: 'callData', type: 'bytes' },
        ],
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'aggregate',
    outputs: [
      { name: 'blockNumber', type: 'uint256' },
      { name: 'returnData', type: 'bytes[]' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' },
        ],
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'aggregate3',
    outputs: [
      {
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
        name: 'returnData',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
];

/**
 * Batch multiple contract calls into a single RPC call using Multicall3
 */
export const multicall = async (
  provider: JsonRpcProvider,
  calls: Array<{
    target: string;
    callData: string;
    allowFailure?: boolean;
  }>
): Promise<Array<{ success: boolean; returnData: string }>> => {
  if (calls.length === 0) {
    return [];
  }

  try {
    // Ensure provider is ready (detect network if needed)
    try {
      await provider.getNetwork();
    } catch (networkError: any) {
      // If network detection fails, try to get the network from the provider's connection
      console.warn('Network detection failed, attempting to continue:', networkError?.message);
    }
    
    const multicallContract = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
    
    // Use aggregate3 which allows failures
    const callsWithFailure = calls.map(call => ({
      target: call.target,
      allowFailure: call.allowFailure ?? true,
      callData: call.callData,
    }));

    const result = await multicallContract.aggregate3(callsWithFailure);
    
    return result.map((r: any) => ({
      success: r.success,
      returnData: r.returnData,
    }));
  } catch (error: any) {
    // Check if it's a network error
    if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('could not detect network')) {
      console.error('Multicall network error - provider may not be configured correctly:', error?.message);
      throw new Error(`Network error: ${error?.message || 'Could not connect to RPC provider'}`);
    }
    console.error('Multicall error:', error);
    // Fallback: return all as failed
    return calls.map(() => ({ success: false, returnData: '0x' }));
  }
};

/**
 * Batch multiple showOffer calls into a single multicall
 */
export const batchShowOffers = async (
  provider: JsonRpcProvider,
  contractAddress: string,
  contractInterface: Interface,
  offerIds: number[]
): Promise<Array<{ success: boolean; data: any }>> => {
  if (offerIds.length === 0) {
    return [];
  }

  // Prepare calls
  const calls = offerIds.map(offerId => ({
    target: contractAddress,
    callData: contractInterface.encodeFunctionData('showOffer', [offerId]),
    allowFailure: true, // Allow individual calls to fail
  }));

  // Execute multicall
  const results = await multicall(provider, calls);

  // Decode results
  return results.map((result, index) => {
    if (!result.success) {
      return { success: false, data: null };
    }

    try {
      const decoded = contractInterface.decodeFunctionResult('showOffer', result.returnData);
      return {
        success: true,
        data: decoded,
      };
    } catch (error) {
      console.error(`Error decoding offer ${offerIds[index]}:`, error);
      return { success: false, data: null };
    }
  });
};

