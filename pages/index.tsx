import { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { Flex, Button, Container, Title, Text } from '@mantine/core';
import { IconEye } from '@tabler/icons';
import { ConnectedProvider } from 'src/providers/ConnectProvider';

const HomePage: NextPage = () => {
  const router = useRouter();

  // Redirect to view-offer page
  useEffect(() => {
    router.push('/view-offer');
  }, [router]);

  return (
    <ConnectedProvider>
      <Container size="md" py="xl">
        <Flex direction="column" align="center" gap="md" justify="center" style={{ minHeight: '50vh' }}>
          <Title order={1}>YAM Interface</Title>
          <Text c="dimmed" mb="lg">Redirecting to View Offer page...</Text>
          <Button
            leftSection={<IconEye size={18} />}
            onClick={() => router.push('/view-offer')}
            color="brand"
            size="lg"
          >
            View Offer
          </Button>
        </Flex>
      </Container>
    </ConnectedProvider>
  );
};

export default HomePage;