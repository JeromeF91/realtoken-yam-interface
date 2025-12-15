import { NextPage } from 'next';
import { useRouter } from 'next/router';
import 'src/components/Market';
import { MarketTableFilter } from 'src/components/Market/Filters';
import { Flex, Group, Button } from '@mantine/core';
import { IconPlus, IconEye } from '@tabler/icons';
import Display from 'src/components/Display/Display';
import { ConnectedProvider } from 'src/providers/ConnectProvider';

const HomePage: NextPage = () => {
  const router = useRouter();

  return (
    <ConnectedProvider>
      <Flex my={"xl"} direction={"column"} gap={"md"}>
        <Group justify="flex-end" mb="sm">
          <Button
            leftSection={<IconPlus size={18} />}
            onClick={() => router.push('/create-offer')}
            color="brand"
            variant="light"
          >
            Create Offer
          </Button>
          <Button
            leftSection={<IconEye size={18} />}
            onClick={() => router.push('/view-offer')}
            color="brand"
            variant="light"
          >
            View Offer
          </Button>
        </Group>
        <MarketTableFilter />
        <Display />
      </Flex>
    </ConnectedProvider>
  );
};

export default HomePage;