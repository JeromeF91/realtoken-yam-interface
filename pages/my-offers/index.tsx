import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flex, Tabs } from '@mantine/core';
import { IconFingerprint, IconList, IconPlus } from '@tabler/icons';
import {
  MarketTablePrivate,
  MarketTableUser,
} from 'src/components/Market/MarketTable';
import { CreateOffer } from 'src/components/CreateOffer/CreateOffers';
import { ConnectedProvider } from 'src/providers/ConnectProvider';

const TransfersPage = () => {
  const menu = useTranslation('menu', { keyPrefix: 'subMenuMyOffer' });
  const [activeTab, setActiveTab] = useState<string>('myOffers');
  
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