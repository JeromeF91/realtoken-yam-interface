import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useWeb3React } from '@web3-react/core';
import {
  Container,
  TextInput,
  Button,
  Card,
  Stack,
  Text,
  Flex,
  Divider,
  Skeleton,
  Alert,
  Title,
  Paper,
  Group,
  Badge,
} from '@mantine/core';
import { IconSearch, IconAlertCircle, IconInfoCircle, IconShoppingCart } from '@tabler/icons';
import BigNumber from 'bignumber.js';

import { ConnectedProvider } from 'src/providers/ConnectProvider';
import { fetchOfferRpc } from 'src/utils/rpc/fetchOfferRpc';
import { usePropertiesToken } from 'src/hooks/usePropertiesToken';
import { usePrices } from 'src/hooks/interface/usePrices';
import { useWlProperties } from 'src/hooks/interface/useWlProperties';
import { Offer } from 'src/types/offer/Offer';
import { BuyActionsWithPermit } from 'src/components/Market/BuyActions/BuyActionsWithPermit';
import { CHAINS, ChainsID } from 'src/constants';

const ShowOfferPage = () => {
  const router = useRouter();
  const { account, provider, chainId } = useWeb3React();
  
  const [offerId, setOfferId] = useState<string>('');
  const [offer, setOffer] = useState<Offer | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { propertiesToken, propertiesIsloading } = usePropertiesToken();
  const { prices } = usePrices();
  const { wlProperties } = useWlProperties();

  // Check if offerId is in URL query params
  useEffect(() => {
    if (router.query.id) {
      setOfferId(router.query.id as string);
    }
  }, [router.query.id]);

  // Fetch offer when offerId changes
  useEffect(() => {
    const fetchOffer = async () => {
      if (!offerId || !chainId || !provider || !account || !propertiesToken || !prices || !wlProperties) {
        return;
      }

      const id = parseInt(offerId);
      if (isNaN(id) || id < 0) {
        setError('Please enter a valid offer ID (number)');
        setOffer(undefined);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        console.log('Fetching offer with chainId:', chainId, 'offerId:', id);
        
        if (!chainId) {
          setError('No chain ID detected. Please connect your wallet and switch to the correct network.');
          setIsLoading(false);
          return;
        }
        
        const fetchedOffer = await fetchOfferRpc(
          provider,
          account,
          chainId,
          id,
          propertiesToken,
          wlProperties,
          prices
        );

        if (fetchedOffer) {
          setOffer(fetchedOffer);
          setError(null);
        } else {
          setError('Offer not found. Please check the offer ID.');
          setOffer(undefined);
        }
      } catch (err: any) {
        console.error('Error fetching offer:', err);
        setError(err?.message || 'Failed to fetch offer. Please try again.');
        setOffer(undefined);
      } finally {
        setIsLoading(false);
      }
    };

    if (offerId && chainId && provider && account && propertiesToken && prices && wlProperties) {
      fetchOffer();
    }
  }, [offerId, chainId, provider, account, propertiesToken, prices, wlProperties]);

  const handleSearch = () => {
    if (!offerId) {
      setError('Please enter an offer ID');
      return;
    }
    
    const id = parseInt(offerId);
    if (isNaN(id) || id < 0) {
      setError('Please enter a valid offer ID (number)');
      return;
    }

    // Update URL without reload
    router.push(`/show-offer?id=${id}`, undefined, { shallow: true });
  };

  const isConnected = !!account && !!provider && !!chainId;
  const chainName = chainId ? CHAINS[chainId as ChainsID]?.chainName : 'Unknown';

  return (
    <ConnectedProvider>
      <Container size="md" py="xl">
        <Stack gap="xl" align="center">
          <Title order={1} size="h2">Show Offer</Title>
          
          <Paper p="lg" withBorder style={{ width: '100%', maxWidth: 600 }}>
            <Stack gap="md">
              <TextInput
                label="Offer ID"
                placeholder="Enter offer ID (e.g., 123)"
                value={offerId}
                onChange={(e) => {
                  setOfferId(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch();
                  }
                }}
                size="lg"
                rightSection={
                  <Button
                    onClick={handleSearch}
                    disabled={!offerId || isLoading}
                    loading={isLoading}
                    leftSection={<IconSearch size={18} />}
                  >
                    Search
                  </Button>
                }
              />
              
              {!isConnected && (
                <Alert icon={<IconInfoCircle size={16} />} color="blue">
                  Please connect your wallet to view offer details
                </Alert>
              )}

              {isConnected && (
                <Badge color="green" variant="light">
                  Connected to {chainName}
                </Badge>
              )}
            </Stack>
          </Paper>

          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error" style={{ width: '100%', maxWidth: 600 }}>
              {error}
            </Alert>
          )}

          {isLoading && (
            <Card withBorder p="md" style={{ width: '100%', maxWidth: 600 }}>
              <Stack gap="md">
                <Skeleton height={20} width="60%" />
                <Skeleton height={20} width="80%" />
                <Skeleton height={20} width="40%" />
              </Stack>
            </Card>
          )}

          {offer && !isLoading && (
            <Card withBorder p="lg" style={{ width: '100%', maxWidth: 800 }}>
              <Stack gap="md">
                <Group justify="space-between" align="center">
                  <Title order={2}>Offer #{offer.offerId}</Title>
                  {offer.sellerAddress === account?.toLowerCase() && (
                    <Badge color="orange" variant="light">Your Offer</Badge>
                  )}
                </Group>

                <Divider />

                <Stack gap="sm">
                  <Flex justify="space-between">
                    <Text fw={700}>Offer Token:</Text>
                    <Text>{offer.offerTokenName} ({offer.offerTokenSymbol})</Text>
                  </Flex>
                  
                  <Flex justify="space-between">
                    <Text fw={700}>Buyer Token:</Text>
                    <Text>{offer.buyerTokenName} ({offer.buyerTokenSymbol})</Text>
                  </Flex>
                  
                  <Flex justify="space-between">
                    <Text fw={700}>Seller:</Text>
                    <Text style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>
                      {offer.sellerAddress.slice(0, 6)}...{offer.sellerAddress.slice(-4)}
                    </Text>
                  </Flex>
                  
                  {offer.buyerAddress && offer.buyerAddress !== '0x0000000000000000000000000000000000000000' && (
                    <Flex justify="space-between">
                      <Text fw={700}>Buyer:</Text>
                      <Text style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>
                        {offer.buyerAddress.slice(0, 6)}...{offer.buyerAddress.slice(-4)}
                      </Text>
                    </Flex>
                  )}
                  
                  <Divider />
                  
                  <Flex justify="space-between">
                    <Text fw={700}>Amount:</Text>
                    <Text>{new BigNumber(offer.amount).toFixed()} {offer.offerTokenSymbol}</Text>
                  </Flex>
                  
                  <Flex justify="space-between">
                    <Text fw={700}>Available:</Text>
                    <Text>{new BigNumber(offer.availableAmount).toFixed()} {offer.offerTokenSymbol}</Text>
                  </Flex>
                  
                  <Divider />
                  
                  <Stack gap={3}>
                    <Text fw={700}>Price:</Text>
                    <Text>{`1 ${offer.offerTokenSymbol} = ${offer.price} ${offer.buyerTokenSymbol}`}</Text>
                    <Text c="dimmed" size="sm">
                      {`1 ${offer.buyerTokenSymbol} = ${new BigNumber(1).dividedBy(offer.price).toFixed(5)} ${offer.offerTokenSymbol}`}
                    </Text>
                  </Stack>
                </Stack>

                <Divider />

                <Flex justify="center" gap="md">
                  <BuyActionsWithPermit
                    buyOffer={offer}
                    loading={isLoading}
                  />
                </Flex>
              </Stack>
            </Card>
          )}

          <Text size="sm" c="dimmed" mt="xl">
            This website will be discontinued after Dec 31, 2025. Thanks
          </Text>
        </Stack>
      </Container>
    </ConnectedProvider>
  );
};

export default ShowOfferPage;

