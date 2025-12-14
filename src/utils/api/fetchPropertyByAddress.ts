import axios from 'axios';
import { APIPropertiesToken, PropertiesToken } from 'src/types/PropertiesToken';
import { ChainsID } from '../../constants';

/**
 * Fetch property information by contract address or UUID from the RealToken Community API
 */
export const fetchPropertyByAddress = async (
  addressOrUuid: string,
  chainId: number
): Promise<PropertiesToken | null> => {
  try {
    const apiKey = process.env.NEXT_PUBLIC_COMMUNITY_API_KEY ?? process.env.COMMUNITY_API_KEY ?? '';
    if (!apiKey) {
      console.warn('COMMUNITY_API_KEY is not set. API requests may fail.');
    }

    const response = await axios.get<APIPropertiesToken[]>(
      'https://api.realtoken.community/v1/token',
      {
        headers: {
          'X-AUTH-REALT-TOKEN': apiKey,
        },
      }
    );

    const tokens: APIPropertiesToken[] = response.data;
    const addressLower = addressOrUuid.toLowerCase();

    // Find property by UUID or contract address
    const property = tokens.find((token) => {
      // Check UUID
      if (token.uuid.toLowerCase() === addressLower) {
        return true;
      }

      // Check contract addresses for the given chain
      const contractKey = getContractAddressKey(chainId);
      if (contractKey) {
        const contractAddress = token.blockchainAddresses[contractKey]?.contract?.toLowerCase();
        if (contractAddress === addressLower) {
          return true;
        }
      }

      // Also check legacy contract fields
      if (chainId === ChainsID.Ethereum && token.ethereumContract?.toLowerCase() === addressLower) {
        return true;
      }
      if (chainId === ChainsID.Gnosis) {
        if (token.gnosisContract?.toLowerCase() === addressLower || 
            token.xDaiContract?.toLowerCase() === addressLower) {
          return true;
        }
      }

      return false;
    });

    if (!property) {
      console.log(`Property not found for address/UUID: ${addressOrUuid} on chain ${chainId}`);
      return null;
    }

    // Convert to PropertiesToken format
    const contractKey = getContractAddressKey(chainId);
    const contractAddress = contractKey
      ? property.blockchainAddresses[contractKey]?.contract?.toLowerCase()
      : undefined;

    if (!contractAddress) {
      console.warn(`No contract address found for chain ${chainId} in property ${property.uuid}`);
      return null;
    }

    return {
      uuid: property.uuid,
      shortName: property.shortName,
      fullName: property.fullName,
      contractAddress: contractAddress,
      officialPrice: property.tokenPrice,
      currency: property.currency,
      marketplaceLink: property.marketplaceLink,
      imageLink: property.imageLink,
      netRentYearPerToken: property.netRentYearPerToken ?? 0,
      annualYield:
        property.netRentYearPerToken && property.tokenPrice
          ? property.netRentYearPerToken / property.tokenPrice
          : 0,
      tokenIdRules: property.tokenIdRules,
    };
  } catch (error: any) {
    console.error('Failed to fetch property from community API:', {
      addressOrUuid,
      chainId,
      message: error?.message,
      status: error?.response?.status,
      data: error?.response?.data,
    });
    return null;
  }
};

/**
 * Get the contract address key for a given chain ID
 */
const getContractAddressKey = (chainId: number): keyof APIPropertiesToken['blockchainAddresses'] | undefined => {
  switch (chainId) {
    case ChainsID.Ethereum:
      return 'ethereum';
    case ChainsID.Gnosis:
      return 'xDai'; // xDai is used for Gnosis chain
    case ChainsID.Sepolia:
      return 'sepolia';
    default:
      return undefined;
  }
};

