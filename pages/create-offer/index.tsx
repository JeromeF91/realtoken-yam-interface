import { useEffect } from 'react';
import { useQueryClient } from 'react-query';
import { useWeb3React } from '@web3-react/core';
import { Container, Title } from '@mantine/core';
import { CreateOffer } from 'src/components/CreateOffer/CreateOffers';
import { ConnectedProvider } from 'src/providers/ConnectProvider';
import { mergeExtendedProperties } from 'src/utils/properties';
import { getExtendedTokens } from 'src/constants/GetPriceToken';

const CreateOfferPage = () => {
  const queryClient = useQueryClient();
  const { chainId } = useWeb3React();

  // Prefetch properties API when page loads
  useEffect(() => {
    if (!chainId) return;

    const prefetchProperties = async () => {
      try {
        // Check if data is already in cache
        const cachedData = queryClient.getQueryData(['properties', chainId]);
        if (cachedData) {
          return; // Already cached, no need to prefetch
        }

        // Prefetch in background
        const response = await fetch(`/api/properties/${chainId}`);
        if (response.ok) {
          const responseJson = await response.json();
          const mergedProperties = mergeExtendedProperties(responseJson, getExtendedTokens(chainId));
          queryClient.setQueryData(['properties', chainId], mergedProperties);
        }
      } catch (error) {
        // Silently fail - the hook will fetch it when needed
        console.error('Error prefetching properties:', error);
      }
    };

    // Prefetch on mount
    prefetchProperties();
  }, [chainId, queryClient]);

  return (
    <ConnectedProvider>
      <Container size="lg" py="xl">
        <Title order={1} mb="xl">Create Offer</Title>
        <CreateOffer />
      </Container>
    </ConnectedProvider>
  );
};

export default CreateOfferPage;

