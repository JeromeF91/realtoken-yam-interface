import {
  ApolloClient,
  InMemoryCache,
  NormalizedCacheObject,
  createHttpLink,
} from '@apollo/client';
import { setContext } from '@apollo/client/link/context';

export const getTheGraphUrlYAM = (chainId: number): string => {
  switch (chainId) {
    case 1:
      return 'https://api.thegraph.com/subgraphs/name/realtoken-thegraph/yam-realt-subgraph';
    case 5:
      return 'https://api.thegraph.com/subgraphs/name/realtoken-thegraph/yam-realt-subgraph-goerli';
    case 100:
      return 'https://gnosis-mainnet.graph-eu.p2pify.com/144b769c6a2babc002760ad88a90ba24/Yam-Gnosis';
    default:
      return '';
  }
};
// get the authentication token from environment variable
const token = process.env.NEXT_PUBLIC_API_KEY ?? process.env.API_KEY ?? undefined;
if (!token) {
  console.warn('No API key found in NEXT_PUBLIC_API_KEY or API_KEY environment variables. GraphQL requests may fail.');
} else {
  console.log('API key found, length:', token.length);
}

export const getYamClient = (
  chainId: number
): ApolloClient<NormalizedCacheObject> => {
  return new ApolloClient({
    uri: getTheGraphUrlYAM(chainId),
    cache: new InMemoryCache(),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
};

export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? undefined;
if (!apiUrl) {
  console.error('Missing "NEXT_PUBLIC_API_URL" environment variable');
  // Use a default or throw a more descriptive error
  throw new Error('Missing "NEXT_PUBLIC_API_URL" environment variable. Please set it in your .env file.');
}

const link = createHttpLink({
  uri: apiUrl,
  // Add error handling for non-JSON responses
  fetch: async (uri: RequestInfo | URL, options?: RequestInit) => {
    // Use global fetch (available in both browser and Node.js 18+)
    const response = await fetch(uri, options);
    const contentType = response.headers.get('content-type');
    
    // Check if response is JSON, if not, log the error
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('GraphQL endpoint returned non-JSON response:', {
        url: typeof uri === 'string' ? uri : uri.toString(),
        status: response.status,
        statusText: response.statusText,
        contentType,
        preview: text.substring(0, 200),
      });
      throw new Error(`GraphQL endpoint returned ${response.status} ${response.statusText}. Expected JSON but got ${contentType}. Check that NEXT_PUBLIC_API_URL is correct. Current value: ${apiUrl}`);
    }
    
    return response;
  },
});

const authLink = setContext((_, { headers }) => {
  // return the headers to the context so httpLink can read them
  return {
    headers: {
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
});

export const apiClient = new ApolloClient({
  cache: new InMemoryCache(),
  link: authLink.concat(link),
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  // Add default options to handle errors better
  defaultOptions: {
    query: {
      errorPolicy: 'all',
    },
  },
});
