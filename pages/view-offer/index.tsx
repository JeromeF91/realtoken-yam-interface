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
      if (!offerId) {
        return;
      }
      
      // Log what's missing
      if (!chainId) console.log('Waiting for chainId...');
      if (!provider) console.log('Waiting for provider...');
      if (!account) console.log('Waiting for account...');
      if (!propertiesToken) console.log('Waiting for propertiesToken...');
      if (!prices) console.log('Waiting for prices...');
      if (!wlProperties) console.log('Waiting for wlProperties...');
      
      // wlProperties is optional - only used for accountWhitelisted flag
      if (!chainId || !provider || !account || !propertiesToken || !prices) {
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
        
        // wlProperties is optional - pass empty array if not loaded yet
        const fetchedOffer = await fetchOfferRpc(
          provider,
          account,
          chainId,
          id,
          propertiesToken,
          wlProperties || [],
          prices
        );

        if (fetchedOffer) {
          setOffer(fetchedOffer);
          setError(null);
          
          // Fetch property tokens for the offer
          const fetchedPropertyTokens = [];
          if (fetchedOffer.buyerTokenType === 1) {
            const token = getPropertyToken(fetchedOffer.buyerTokenAddress);
            if (token) fetchedPropertyTokens.push(token);
          }
          if (fetchedOffer.offerTokenType === 1) {
            const token = getPropertyToken(fetchedOffer.offerTokenAddress);
            if (token) fetchedPropertyTokens.push(token);
          }
          setPropertyTokens(fetchedPropertyTokens);
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

    // Don't wait for wlProperties - it's only used for accountWhitelisted flag, not critical for viewing
    if (offerId && chainId && provider && account && propertiesToken && prices) {
      fetchOffer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId, chainId, provider, account, propertiesToken, prices]);

  // Load property tokens when offer or propertiesToken changes
  useEffect(() => {
    if (!offer || propertiesIsloading || !propertiesToken) return;

    const tokens: any[] = [];
    
    if (offer.buyerTokenType == 1) {
      const token = getPropertyToken(offer.buyerTokenAddress);
      if (token) tokens.push(token);
    }

    if (offer.offerTokenType == 1) {
      const token = getPropertyToken(offer.offerTokenAddress);
      if (token) tokens.push(token);
    }

    // Only update if tokens changed to avoid infinite loop
    if (tokens.length !== propertyTokens.length || 
        tokens.some((t, i) => t?.contractAddress !== propertyTokens[i]?.contractAddress)) {
      setPropertyTokens(tokens);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer?.buyerTokenAddress, offer?.offerTokenAddress, offer?.buyerTokenType, offer?.offerTokenType, propertiesToken, propertiesIsloading]);

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
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <Title order={1}>View Offer by ID</Title>
        
        {!isConnected && (
          <Alert icon={<IconInfoCircle size={16} />} color="blue" title="Wallet Not Connected">
            Please connect your wallet to view offer details. Once connected, you can search for offers by ID.
          </Alert>
        )}
        
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
                if (e.key === 'Enter' && isConnected) {
                  handleSearch();
                }
              }}
              rightSection={
                <Button
                  onClick={handleSearch}
                  disabled={!offerId || isLoading || !isConnected}
                  loading={isLoading}
                  leftSection={<IconSearch size={16} />}
                >
                  Search
                </Button>
              }
            />
            
            {isConnected && chainId && (
              <Alert icon={<IconInfoCircle size={16} />} color="green" variant="light">
                Connected to chain {chainId}. Ready to fetch offer {offerId || '(enter ID above)'}
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
                    title="Seller Address"
                    value={offer.buyerTokenAddress}
                  />
                  <OfferText
                    title="Token Smart Contract"
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
                    value={new BigNumber(offer.amount).shiftedBy(-Number(offer.offerTokenDecimals || 18)).toFixed(2)}
                  />
                  <OfferText
                    title="Available Amount"
                    value={new BigNumber(offer.availableAmount).shiftedBy(-Number(offer.offerTokenDecimals || 18)).toFixed(2)}
                  />
                  
                  <Flex direction="column" gap={3}>
                    <Text fw={700}>Price</Text>
                    {offer.offerTokenName && offer.buyerTokenName && offer.price ? (
                      <>
                        <Text>
                          {`1 ${offer.offerTokenName} = ${new BigNumber(offer.price).toFixed(6)} ${offer.buyerTokenName}`}
                          {offer.offerPrice && ` ($${parseFloat(offer.offerPrice.toString()).toFixed(2)})`}
                        </Text>
                        <Text>
                          {`1 ${offer.buyerTokenName} = ${new BigNumber(1).dividedBy(offer.price).toFixed(6)} ${offer.offerTokenName}`}
                        </Text>
                      </>
                    ) : (
                      <Skeleton height={25} width={400} />
                    )}
                  </Flex>
                  
                  {offer.priceDelta !== undefined && (
                    <OfferText
                      title="PriceDiff"
                      value={`${(offer.priceDelta * 100).toFixed(2)}%`}
                    />
                  )}
                  
                  {offer.offerYield !== undefined && (
                    <OfferText
                      title="NewYield"
                      value={`${offer.offerYield.toFixed(2)}%`}
                    />
                  )}

                  <OfferText
                    title="Seller Balance"
                    value={new BigNumber(offer.balanceWallet || '0').shiftedBy(-Number(offer.offerTokenDecimals || 18)).toFixed(6)}
                  />

                  <OfferText
                    title="Seller Allowance"
                    value={new BigNumber(offer.allowanceToken || '0').shiftedBy(-Number(offer.offerTokenDecimals || 18)).toFixed(6)}
                  />

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
  );
};

export default ViewOfferPage;

