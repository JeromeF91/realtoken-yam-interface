import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { APIPropertiesToken, PropertiesToken } from 'src/types/PropertiesToken';
import { ChainsID } from '../../../../src/constants';

/**
 * In-memory cache for property data
 * Key: `${chainId}:${addressOrUuid.toLowerCase()}`
 * Value: CacheEntry with data and timestamp
 */
interface CacheEntry {
  data: PropertiesToken;
  timestamp: number;
}

const cacheWithTimestamp = new Map<string, CacheEntry>();

/**
 * Cache TTL: 5 minutes (300000 ms)
 */
const CACHE_TTL = 5 * 60 * 1000;

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

/**
 * Server-side API route to fetch property by address or UUID
 * GET /api/property/[chainId]/[address]
 */
const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse<PropertiesToken | { error: string }>
) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { chainId: chainIdParam, address } = req.query;
    
    if (!chainIdParam || !address) {
      return res.status(400).json({ error: 'ChainId and address are required' });
    }

    const chainId = parseInt(chainIdParam as string, 10);
    if (isNaN(chainId)) {
      return res.status(400).json({ error: 'Invalid chainId' });
    }

    const addressOrUuid = address as string;
    const addressLower = addressOrUuid.toLowerCase();
    const cacheKey = `${chainId}:${addressLower}`;
    
    // Check cache first
    const cached = getCachedProperty(cacheKey);
    if (cached) {
      return res
        .setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60')
        .status(200)
        .json(cached);
    }

    const apiKey = process.env.COMMUNITY_API_KEY ?? '';
    if (!apiKey) {
      console.warn('COMMUNITY_API_KEY is not set. API requests may fail.');
    }

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

      // Convert to PropertiesToken format
      const contractKey = getContractAddressKey(chainId);
      let contractAddress = contractKey
        ? property.blockchainAddresses[contractKey]?.contract?.toLowerCase()
        : undefined;

      if (!contractAddress) {
        // Try legacy fields
        if (chainId === ChainsID.Ethereum && property.ethereumContract) {
          contractAddress = property.ethereumContract.toLowerCase();
        } else if (chainId === ChainsID.Gnosis && (property.gnosisContract || property.xDaiContract)) {
          contractAddress = (property.gnosisContract || property.xDaiContract)?.toLowerCase();
        }
      }

      if (!contractAddress) {
        return res.status(404).json({ error: `No contract address found for chain ${chainId}` });
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

      // Cache the result
      setCachedProperty(cacheKey, result);
      
      return res
        .setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60')
        .status(200)
        .json(result);
    } catch (singleTokenError: any) {
      // If single token endpoint fails (404, etc.), fall back to fetching all tokens
      if (singleTokenError?.response?.status === 404) {
        // Try fetching all tokens and searching
        const response = await axios.get<APIPropertiesToken[]>(
          'https://api.realtoken.community/v1/token',
          {
            headers: {
              'X-AUTH-REALT-TOKEN': apiKey,
            },
          }
        );

        const tokens: APIPropertiesToken[] = response.data;

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
          return res.status(404).json({ error: `Property not found for address/UUID: ${addressOrUuid} on chain ${chainId}` });
        }

        // Convert to PropertiesToken format
        const contractKey = getContractAddressKey(chainId);
        let contractAddress = contractKey
          ? property.blockchainAddresses[contractKey]?.contract?.toLowerCase()
          : undefined;

        if (!contractAddress) {
          // Try legacy fields
          if (chainId === ChainsID.Ethereum && property.ethereumContract) {
            contractAddress = property.ethereumContract.toLowerCase();
          } else if (chainId === ChainsID.Gnosis && (property.gnosisContract || property.xDaiContract)) {
            contractAddress = (property.gnosisContract || property.xDaiContract)?.toLowerCase();
          }
        }

        if (!contractAddress) {
          return res.status(404).json({ error: `Could not determine contract address for chain ${chainId}` });
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

        // Cache the result
        setCachedProperty(cacheKey, result);
        
        return res
          .setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60')
          .status(200)
          .json(result);
      }
      
      // Re-throw other errors
      throw singleTokenError;
    }
  } catch (error: any) {
    console.error('[API] Failed to fetch property from community API:', {
      error: error?.message,
      status: error?.response?.status,
      data: error?.response?.data,
    });
    return res.status(500).json({ error: 'Failed to fetch property' });
  }
};

export default handler;

