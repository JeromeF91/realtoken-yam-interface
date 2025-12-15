import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/router';
import { Flex, Tabs, Button, Group } from '@mantine/core';
import { IconFingerprint, IconList, IconPlus } from '@tabler/icons';
import {
  MarketTablePrivate,
  MarketTableUser,
} from 'src/components/Market/MarketTable';
import { ConnectedProvider } from 'src/providers/ConnectProvider';

const TransfersPage = () => {
  const menu = useTranslation('menu', { keyPrefix: 'subMenuMyOffer' });
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<string>('myOffers');
  
  return (
    <ConnectedProvider>
      <Flex
        direction={"column"}
        my={"xl"}
        gap={"md"}
      >
        <Group justify="space-between" align="center">
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
            </Tabs.List>
          </Tabs>
          
          <Button
            leftSection={<IconPlus size={18} />}
            onClick={() => router.push('/create-offer')}
            color="brand"
          >
            {menu.t('addOffer')}
          </Button>
        </Group>

        <Tabs 
          color={"brand"} 
          variant={"pills"} 
          value={activeTab}
          onChange={(value) => setActiveTab(value || 'myOffers')}
        >
          <Tabs.Panel value={'myOffers'} pt={'xs'}>
            {activeTab === 'myOffers' && <MarketTableUser />}
          </Tabs.Panel>

          <Tabs.Panel value={'privateOffers'} pt={'xs'}>
            {activeTab === 'privateOffers' && <MarketTablePrivate />}
          </Tabs.Panel>
        </Tabs>
      </Flex>
    </ConnectedProvider>
  );
};

export default TransfersPage;