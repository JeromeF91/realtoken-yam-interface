import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import axios from 'axios';

import { APIPropertiesToken, PropertiesToken, ShortProperty } from 'src/types';

import { ChainsID } from '../../../src/constants';

/**
 * In-memory cache for community API tokens
 * Value: { data: APIPropertiesToken[], timestamp: number }
 */
interface CommunityTokensCacheEntry {
  data: APIPropertiesToken[];
  timestamp: number;
}

/**
 * In-memory cache for processed properties per chainId
 * Key: chainId
 * Value: { data: PropertiesToken[], timestamp: number }
 */
interface PropertiesCacheEntry {
  data: PropertiesToken[];
  timestamp: number;
}

let communityTokensCache: CommunityTokensCacheEntry | null = null;
const propertiesCache = new Map<number, PropertiesCacheEntry>();

/**
 * Cache TTL: 20 minutes (1200 seconds, matches HTTP cache)
 */
const CACHE_TTL = 20 * 60 * 1000;

/**
 * Get cached community tokens if available and not expired
 */
const getCachedCommunityTokens = (): APIPropertiesToken[] | null => {
  if (!communityTokensCache) {
    return null;
  }
  
  const now = Date.now();
  if (now - communityTokensCache.timestamp > CACHE_TTL) {
    // Cache expired, remove it
    communityTokensCache = null;
    return null;
  }
  
  return communityTokensCache.data;
};

/**
 * Set cached community tokens with timestamp
 */
const setCachedCommunityTokens = (data: APIPropertiesToken[]): void => {
  communityTokensCache = {
    data,
    timestamp: Date.now(),
  };
};

/**
 * Get cached properties for a chainId if available and not expired
 */
const getCachedProperties = (chainId: number): PropertiesToken[] | null => {
  const entry = propertiesCache.get(chainId);
  if (!entry) {
    return null;
  }
  
  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL) {
    // Cache expired, remove it
    propertiesCache.delete(chainId);
    return null;
  }
  
  return entry.data;
};

/**
 * Set cached properties for a chainId with timestamp
 */
const setCachedProperties = (chainId: number, data: PropertiesToken[]): void => {
  propertiesCache.set(chainId, {
    data,
    timestamp: Date.now(),
  });
};

const getTokenFromCommunityAPI = async (): Promise<APIPropertiesToken[]> => {
  // Check cache first
  const cached = getCachedCommunityTokens();
  if (cached) {
    console.log(`Using cached properties from RealToken Community API (${cached.length} tokens)`);
    return cached;
  }

  try {
    const apiKey = process.env.COMMUNITY_API_KEY ?? '';
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
    console.log(`Fetched ${tokens.length} properties from RealToken Community API`);
    
    // Cache the result
    setCachedCommunityTokens(tokens);
    
    return tokens;
  } catch (err: any) {
    console.error('Failed to fetch properties from community API:', {
      message: err?.message,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
      data: err?.response?.data,
    });
    throw err;
  }
};

const getContractAddressFromChainId = (chainId: number): string | undefined => {
  let addressKey;
  switch (chainId) {
    case ChainsID.Ethereum:
      addressKey = 'ethereum';
      break;
    case ChainsID.Gnosis:
      addressKey = 'xDai';
      break;
    case ChainsID.Sepolia:
      addressKey = 'sepolia';
      break;
  }
  return addressKey;
};

const getTokens = async (
  chainId: number,
  communityProperties: APIPropertiesToken[],
  wlProperties: ShortProperty[]
): Promise<PropertiesToken[]> => {
  const propertiesNonFiltered: PropertiesToken[] = [];

  const contractKey = getContractAddressFromChainId(chainId);

  // if(chainId == ChainsID.Sepolia){

  //     const chainConfig = CHAINS[ChainsID.Sepolia];
  //     const { graphPrefixes } = chainConfig;

  //     //
  //     const res = await apiClient.query({
  //         query: gql`
  //             query getTokens{
  //                 ${graphPrefixes.realtoken}{
  //                     tokens{
  //                         tokenId
  //                         address
  //                     }
  //                 }
  //             }
  //         `
  //     })
  //     const properties: any[] = res.data[graphPrefixes.realtoken].tokens;

  //     properties.forEach((propertie) => {
  //         const propertiesCommunity = communityProperties.find((token) => token.tokenIdRules == propertie.tokenId);
  //         if(propertiesCommunity){
  //             propertiesNonFiltered.push({
  //                 ...propertiesCommunity,
  //                 contractAddress: propertie.address,
  //                 officialPrice: propertiesCommunity.tokenPrice,
  //                 annualYield: propertiesCommunity.tokenPrice ? propertiesCommunity.netRentYearPerToken/propertiesCommunity.tokenPrice : 0
  //             })
  //         }
  //     })

  // }else{

  communityProperties.forEach((propertyToken: APIPropertiesToken) => {
    // console.log(propertyToken.blockchainAddresses);
    const contractAddress =
      propertyToken.blockchainAddresses[
        contractKey as keyof typeof propertyToken.blockchainAddresses
      ]?.contract;
    // console.log(contractAddress);
    if (contractAddress) {
      propertiesNonFiltered.push({
        uuid: propertyToken.uuid,
        shortName: propertyToken.shortName,
        fullName: propertyToken.fullName,
        contractAddress: contractAddress.toLowerCase(),
        officialPrice: propertyToken.tokenPrice,
        currency: propertyToken.currency,
        marketplaceLink: propertyToken.marketplaceLink,
        imageLink: propertyToken.imageLink,
        netRentYearPerToken: propertyToken.netRentYearPerToken ?? 0,
        annualYield:
          propertyToken.netRentYearPerToken && propertyToken.tokenPrice
            ? propertyToken.netRentYearPerToken / propertyToken.tokenPrice
            : 0,
        tokenIdRules: propertyToken.tokenIdRules,
      });
    }
  });
  // }

  return propertiesNonFiltered;

  console.log(propertiesNonFiltered);

  const onlyWLProperties = propertiesNonFiltered.filter(
    (property) =>
      !!wlProperties.find(
        (wlProperty) =>
          wlProperty.contractAddress.toLowerCase() ==
          property.contractAddress.toLowerCase()
      )
  );

  return onlyWLProperties;
};

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  try {
    const { chainId: id } = req.query;
    const chainId: string = id as string;

    if (!chainId) {
      return res.status(400).json({ error: 'ChainId is missing.' });
    }

    const chainIdNum = parseInt(chainId);

    // Check cache for processed properties first
    const cachedProperties = getCachedProperties(chainIdNum);
    if (cachedProperties) {
      return res
        .setHeader(
          'cache-control',
          'public, s-maxage=1200, stale-while-revalidate=600'
        )
        .status(200)
        .json(cachedProperties);
    }

    // const [communityApiToken,wlTokens] = await Promise.all([getTokenFromCommunityAPI,getWhitelistedProperties(parseInt(chainId))]);
    const [communityApiToken] = await Promise.all([getTokenFromCommunityAPI()]);
    const tokens = await getTokens(chainIdNum, communityApiToken, []);

    // Cache the processed tokens
    setCachedProperties(chainIdNum, tokens);

    // const extendedTokens = tokenToGetPrice.get(parseInt(chainId))?.filter(token => !token.isBuyToken) ?? [] as PropertiesToken[];
    // console.log(extendedTokens);

    return res
      .setHeader(
        'cache-control',
        'public, s-maxage=1200, stale-while-revalidate=600'
      )
      .status(200)
      .json(tokens);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Failed to fetch properties' });
  }
};
export default handler;
