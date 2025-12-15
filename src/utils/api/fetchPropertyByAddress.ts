import axios from 'axios';
import { APIPropertiesToken, PropertiesToken } from 'src/types/PropertiesToken';
import { ChainsID } from '../../constants';

/**
 * In-memory cache for property data
 * Key: `${chainId}:${addressOrUuid.toLowerCase()}`
 * Value: PropertiesToken
 */
const propertyCache = new Map<string, PropertiesToken>();

/**
 * Cache TTL: 5 minutes (300000 ms)
 */
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Cache entry with timestamp
 */
interface CacheEntry {
  data: PropertiesToken;
  timestamp: number;
}

const cacheWithTimestamp = new Map<string, CacheEntry>();

/**
 * Get cached property if available and not expired
 */
const getCachedProperty = (key: string): PropertiesToken | null => {
  const entry = cacheWithTimestamp.get(key);
  if (!entry) {
    return null;
  }
  
  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL) {
    // Cache expired, remove it
    cacheWithTimestamp.delete(key);
    return null;
  }
  
  return entry.data;
};

/**
 * Set cached property with timestamp
 */
const setCachedProperty = (key: string, data: PropertiesToken): void => {
  cacheWithTimestamp.set(key, {
    data,
    timestamp: Date.now(),
  });
};

/**
 * Fetch property information by contract address or UUID from the RealToken Community API
 * Uses the single token endpoint: /v1/token/{uuid}
 * Results are cached in-memory for 5 minutes to avoid repeated API calls
 */
export const fetchPropertyByAddress = async (
  addressOrUuid: string,
  chainId: number
): Promise<PropertiesToken | null> => {
  try {
    const addressLower = addressOrUuid.toLowerCase();
    const cacheKey = `${chainId}:${addressLower}`;
    
    // Check cache first
    const cached = getCachedProperty(cacheKey);
    if (cached) {
      console.log(`[fetchPropertyByAddress] Using cached property for ${addressOrUuid} on chain ${chainId}`);
      return cached;
    }

    const apiKey = process.env.NEXT_PUBLIC_COMMUNITY_API_KEY ?? process.env.COMMUNITY_API_KEY ?? '';
    if (!apiKey) {
      console.warn('COMMUNITY_API_KEY is not set. API requests may fail.');
    }

    console.log(`[fetchPropertyByAddress] Fetching property for address/UUID: ${addressOrUuid} on chain ${chainId}`);

    // First, try to fetch directly using the UUID/address as the endpoint
    try {
      const singleTokenResponse = await axios.get<APIPropertiesToken>(
        `https://api.realtoken.community/v1/token/${addressOrUuid}`,
        {
          headers: {
            'X-AUTH-REALT-TOKEN': apiKey,
            'accept': '*/*',
          },
        }
      );

      const property = singleTokenResponse.data;
      console.log(`[fetchPropertyByAddress] Successfully fetched property from single token endpoint:`, {
        uuid: property.uuid,
        shortName: property.shortName,
        tokenPrice: property.tokenPrice,
        currency: property.currency,
        netRentYearPerToken: property.netRentYearPerToken,
        annualYield: property.netRentYearPerToken && property.tokenPrice 
          ? (property.netRentYearPerToken / property.tokenPrice) * 100 
          : undefined,
      });

      // Convert to PropertiesToken format
      const contractKey = getContractAddressKey(chainId);
      const contractAddress = contractKey
        ? property.blockchainAddresses[contractKey]?.contract?.toLowerCase()
        : undefined;

      if (!contractAddress) {
        console.warn(`[fetchPropertyByAddress] No contract address found for chain ${chainId} in property ${property.uuid}`);
        // Try legacy fields
        if (chainId === ChainsID.Ethereum && property.ethereumContract) {
          contractAddress = property.ethereumContract.toLowerCase();
        } else if (chainId === ChainsID.Gnosis && (property.gnosisContract || property.xDaiContract)) {
          contractAddress = (property.gnosisContract || property.xDaiContract)?.toLowerCase();
        }
      }

      if (!contractAddress) {
        console.warn(`[fetchPropertyByAddress] Could not determine contract address for chain ${chainId}`);
        return null;
      }

      const annualYield = property.netRentYearPerToken && property.tokenPrice
        ? property.netRentYearPerToken / property.tokenPrice
        : 0;

      const result: PropertiesToken = {
        uuid: property.uuid,
        shortName: property.shortName,
        fullName: property.fullName,
        contractAddress: contractAddress,
        officialPrice: property.tokenPrice,
        currency: property.currency,
        marketplaceLink: property.marketplaceLink,
        imageLink: property.imageLink,
        netRentYearPerToken: property.netRentYearPerToken ?? 0,
        annualYield: annualYield,
        tokenIdRules: property.tokenIdRules,
      };

      console.log(`[fetchPropertyByAddress] Converted property data:`, {
        contractAddress: result.contractAddress,
        officialPrice: result.officialPrice,
        currency: result.currency,
        annualYield: result.annualYield,
        annualYieldPercent: result.annualYield ? (result.annualYield * 100).toFixed(2) + '%' : 'N/A',
      });

      // Cache the result
      setCachedProperty(cacheKey, result);
      return result;
    } catch (singleTokenError: any) {
      // If single token endpoint fails (404, etc.), fall back to fetching all tokens
      console.log(`[fetchPropertyByAddress] Single token endpoint failed, falling back to all tokens:`, {
        status: singleTokenError?.response?.status,
        message: singleTokenError?.message,
      });

      const response = await axios.get<APIPropertiesToken[]>(
        'https://api.realtoken.community/v1/token',
        {
          headers: {
            'X-AUTH-REALT-TOKEN': apiKey,
          },
        }
      );

      const tokens: APIPropertiesToken[] = response.data;
      console.log(`[fetchPropertyByAddress] Fetched ${tokens.length} tokens from all tokens endpoint`);

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
        console.log(`[fetchPropertyByAddress] Property not found for address/UUID: ${addressOrUuid} on chain ${chainId}`);
        return null;
      }

      console.log(`[fetchPropertyByAddress] Found property in all tokens list:`, {
        uuid: property.uuid,
        shortName: property.shortName,
        tokenPrice: property.tokenPrice,
        currency: property.currency,
        netRentYearPerToken: property.netRentYearPerToken,
      });

      // Convert to PropertiesToken format
      const contractKey = getContractAddressKey(chainId);
      let contractAddress = contractKey
        ? property.blockchainAddresses[contractKey]?.contract?.toLowerCase()
        : undefined;

      if (!contractAddress) {
        console.warn(`[fetchPropertyByAddress] No contract address found for chain ${chainId} in property ${property.uuid}`);
        // Try legacy fields
        if (chainId === ChainsID.Ethereum && property.ethereumContract) {
          contractAddress = property.ethereumContract.toLowerCase();
        } else if (chainId === ChainsID.Gnosis && (property.gnosisContract || property.xDaiContract)) {
          contractAddress = (property.gnosisContract || property.xDaiContract)?.toLowerCase();
        }
      }

      if (!contractAddress) {
        console.warn(`[fetchPropertyByAddress] Could not determine contract address for chain ${chainId}`);
        return null;
      }

      const annualYield = property.netRentYearPerToken && property.tokenPrice
        ? property.netRentYearPerToken / property.tokenPrice
        : 0;

      const result: PropertiesToken = {
        uuid: property.uuid,
        shortName: property.shortName,
        fullName: property.fullName,
        contractAddress: contractAddress,
        officialPrice: property.tokenPrice,
        currency: property.currency,
        marketplaceLink: property.marketplaceLink,
        imageLink: property.imageLink,
        netRentYearPerToken: property.netRentYearPerToken ?? 0,
        annualYield: annualYield,
        tokenIdRules: property.tokenIdRules,
      };

      console.log(`[fetchPropertyByAddress] Converted property data (fallback):`, {
        contractAddress: result.contractAddress,
        officialPrice: result.officialPrice,
        currency: result.currency,
        annualYield: result.annualYield,
        annualYieldPercent: result.annualYield ? (result.annualYield * 100).toFixed(2) + '%' : 'N/A',
      });

      // Cache the result
      setCachedProperty(cacheKey, result);
      return result;
    }
  } catch (error: any) {
    console.error('[fetchPropertyByAddress] Failed to fetch property from community API:', {
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

