import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Flex, Tabs } from '@mantine/core';
import { IconFingerprint, IconList, IconPlus } from '@tabler/icons';
import { useQueryClient } from 'react-query';
import { useWeb3React } from '@web3-react/core';
import {
  MarketTablePrivate,
  MarketTableUser,
} from 'src/components/Market/MarketTable';
import { CreateOffer } from 'src/components/CreateOffer/CreateOffers';
import { ConnectedProvider } from 'src/providers/ConnectProvider';
import { mergeExtendedProperties } from 'src/utils/properties';
import { getExtendedTokens } from 'src/constants/GetPriceToken';

const TransfersPage = () => {
  const menu = useTranslation('menu', { keyPrefix: 'subMenuMyOffer' });
  const [activeTab, setActiveTab] = useState<string>('myOffers');
  const queryClient = useQueryClient();
  const { chainId } = useWeb3React();

  // Prefetch properties API when page loads or when addOffer tab becomes active
  useEffect(() => {
    if (!chainId) return;

    // Prefetch properties API call
    const prefetchProperties = async () => {
      try {
        // Check if data is already in cache
        const cachedData = queryClient.getQueryData(['properties', chainId]);
        if (cachedData) {
          return; // Already cached, no need to prefetch
        }

        const response = await fetch(`/api/properties/${chainId}`);
        if (response.ok) {
          const responseJson = await response.json();
          const mergedProperties = mergeExtendedProperties(responseJson, getExtendedTokens(chainId));
          
          // Prefetch into React Query cache
          queryClient.setQueryData(['properties', chainId], mergedProperties);
        }
      } catch (error) {
        console.error('Error prefetching properties:', error);
      }
    };

    // Prefetch when addOffer tab is active
    if (activeTab === 'addOffer') {
      prefetchProperties();
    }
  }, [activeTab, chainId, queryClient]);

  // Also prefetch on initial load if chainId is available
  useEffect(() => {
    if (!chainId) return;

    const prefetchOnLoad = async () => {
      try {
        // Check if data is already in cache
        const cachedData = queryClient.getQueryData(['properties', chainId]);
        if (cachedData) {
          return; // Already cached
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
        console.error('Error prefetching properties on load:', error);
      }
    };

    // Prefetch on mount (runs once when component mounts)
    prefetchOnLoad();
  }, [chainId, queryClient]);
  
  return (
    <ConnectedProvider>
      <Flex
        direction={"column"}
        my={"xl"}
      >
        <Tabs 
          color={"brand"} 
          variant={"pills"} 
          value={activeTab}
          onChange={(value) => setActiveTab(value || 'myOffers')}
        >
          <Tabs.List>
            <Tabs.Tab 
              value={'myOffers'} 
              rightSection={<IconList size={18} />}
            >
              {menu.t('myOffers')}
            </Tabs.Tab>
            <Tabs.Tab
              value={'privateOffers'}
              rightSection={<IconFingerprint size={18} />}
            >
              {menu.t('privateOffers')}
            </Tabs.Tab>
            <Tabs.Tab 
              value={'addOffer'} 
              rightSection={<IconPlus size={18} />}
            >
              {menu.t('addOffer')}
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value={'myOffers'} pt={'xs'}>
            {activeTab === 'myOffers' && <MarketTableUser />}
          </Tabs.Panel>

          <Tabs.Panel value={'privateOffers'} pt={'xs'}>
            {activeTab === 'privateOffers' && <MarketTablePrivate />}
          </Tabs.Panel>

          <Tabs.Panel value={'addOffer'} pt={'xs'}>
            {activeTab === 'addOffer' && <CreateOffer />}
          </Tabs.Panel>
        </Tabs>
      </Flex>
    </ConnectedProvider>
  );
};

export default TransfersPage;