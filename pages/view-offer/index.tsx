import { useState, useEffect, useMemo } from 'react';
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
  Group,
  Paper,
  Title,
} from '@mantine/core';
import { IconSearch, IconAlertCircle, IconInfoCircle } from '@tabler/icons';
import { useTranslation } from 'react-i18next';
import BigNumber from 'bignumber.js';

import { ConnectedProvider } from 'src/providers/ConnectProvider';
import { fetchOfferRpc } from 'src/utils/rpc/fetchOfferRpc';
import { usePropertiesToken } from 'src/hooks/usePropertiesToken';
import { usePrices } from 'src/hooks/interface/usePrices';
import { useWlProperties } from 'src/hooks/interface/useWlProperties';
import { Offer } from 'src/types/offer/Offer';
import { PropertyCard } from 'src/components/Offer/PropertyCard/PropertyCard';
import { BuyActionsWithPermit } from 'src/components/Market/BuyActions/BuyActionsWithPermit';
import { OfferText } from 'src/components/Offer/OfferText';

const ViewOfferPage = () => {
  const router = useRouter();
  const { account, provider, chainId } = useWeb3React();
  const { t } = useTranslation('modals', { keyPrefix: 'buy' });
  
  const [offerId, setOfferId] = useState<string>('');
  const [offer, setOffer] = useState<Offer | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [propertyTokens, setPropertyTokens] = useState<any[]>([]);

  const { propertiesToken, propertiesIsloading, getPropertyToken } = usePropertiesToken();
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
        // Log chainId for debugging
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

  // Load property tokens when offer is available
  useEffect(() => {
    if (!offer || propertiesIsloading || propertyTokens.length > 0) return;

    const tokens: any[] = [];
    
    if (offer.buyerTokenType == 1) {
      const token = getPropertyToken(offer.buyerTokenAddress);
      if (token) tokens.push(token);
    }

    if (offer.offerTokenType == 1) {
      const token = getPropertyToken(offer.offerTokenAddress);
      if (token) tokens.push(token);
    }

    if (tokens.length > 0) {
      setPropertyTokens(tokens);
    }
  }, [offer, propertiesIsloading, getPropertyToken]);

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
    router.push(`/view-offer?id=${id}`, undefined, { shallow: true });
  };

  const isAccountOffer = useMemo(() => {
    if (!offer || !account) return false;
    return offer.sellerAddress === account.toLowerCase();
  }, [offer, account]);

  const isConnected = !!account && !!provider && !!chainId;

  return (
    <ConnectedProvider>
      <Container size="lg" py="xl">
        <Stack gap="xl">
          <Title order={1}>View Offer by ID</Title>
          
          <Paper p="md" withBorder>
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
                rightSection={
                  <Button
                    onClick={handleSearch}
                    disabled={!offerId || isLoading}
                    loading={isLoading}
                    leftSection={<IconSearch size={16} />}
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
            </Stack>
          </Paper>

          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
              {error}
            </Alert>
          )}

          {isLoading && (
            <Card withBorder p="md">
              <Stack gap="md">
                <Skeleton height={20} width="60%" />
                <Skeleton height={20} width="80%" />
                <Skeleton height={20} width="40%" />
              </Stack>
            </Card>
          )}

          {offer && !isLoading && (
            <Card withBorder p="md">
              <Stack gap="md">
                <Group justify="space-between" align="center">
                  <Title order={2}>Offer #{offer.offerId}</Title>
                  {isAccountOffer && (
                    <Text size="sm" c="dimmed">Your Offer</Text>
                  )}
                </Group>

                <Divider />

                <Stack gap="sm">
                  <OfferText
                    title={t("offerTokenName")}
                    value={offer.offerTokenName}
                  />
                  <OfferText
                    title={t("buyerTokenName")}
                    value={offer.buyerTokenName}
                  />
                  <OfferText
                    title={t("sellerAddress")}
                    value={offer.sellerAddress}
                  />
                  {offer.buyerAddress && offer.buyerAddress !== '0x0000000000000000000000000000000000000000' && (
                    <OfferText
                      title="Buyer Address"
                      value={offer.buyerAddress}
                    />
                  )}
                  <OfferText
                    title={t("amount")}
                    value={offer.amount}
                  />
                  <OfferText
                    title="Available Amount"
                    value={offer.availableAmount}
                  />
                  
                  <Flex direction="column" gap={3}>
                    <Text fw={700}>Price</Text>
                    {offer.offerTokenName && offer.buyerTokenName && offer.price ? (
                      <>
                        <Text>{`1 "${offer.offerTokenName}" = ${offer.price} "${offer.buyerTokenName}"`}</Text>
                        <Text>{`1 "${offer.buyerTokenName}" = ${new BigNumber(1).dividedBy(offer.price).toFixed(5)} ${offer.offerTokenName}`}</Text>
                      </>
                    ) : (
                      <Skeleton height={25} width={400} />
                    )}
                  </Flex>

                  {offer.balanceWallet && (
                    <OfferText
                      title="Seller Balance"
                      value={offer.balanceWallet}
                    />
                  )}

                  {offer.allowanceToken && (
                    <OfferText
                      title="Seller Allowance"
                      value={offer.allowanceToken}
                    />
                  )}

                  {offer.createdAtTimestamp > 0 && (
                    <OfferText
                      title="Created At"
                      value={new Date(offer.createdAtTimestamp * 1000).toLocaleString()}
                    />
                  )}
                </Stack>

                <Divider />

                <Flex direction="column" gap="md" align="center">
                  <BuyActionsWithPermit
                    buyOffer={offer}
                    loading={isLoading}
                  />
                </Flex>
              </Stack>
            </Card>
          )}

          {offer && propertyTokens.length > 0 && (
            <Stack gap="md">
              <Title order={3}>Property Information</Title>
              <Flex direction="column" gap="md" align="center" w="100%">
                {propertyTokens.map((token) => (
                  <PropertyCard
                    key={token.contractAddress}
                    propertyToken={token}
                    offer={offer}
                  />
                ))}
              </Flex>
            </Stack>
          )}
        </Stack>
      </Container>
    </ConnectedProvider>
  );
};

export default ViewOfferPage;

