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
  Badge,
  Grid,
  Box,
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
import { fetchPropertyByAddress } from 'src/utils/api/fetchPropertyByAddress';
import { PropertiesToken } from 'src/types/PropertiesToken';

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
          const fetchedPropertyTokens: PropertiesToken[] = [];
          
          // First, try to get from local properties cache
          if (fetchedOffer.buyerTokenType === 1) {
            const token = getPropertyToken(fetchedOffer.buyerTokenAddress);
            if (token) {
              fetchedPropertyTokens.push(token);
            } else {
              // If not found locally, try fetching from API using the address
              console.log(`Property not found locally for buyerToken ${fetchedOffer.buyerTokenAddress}, fetching from API...`);
              const apiToken = await fetchPropertyByAddress(fetchedOffer.buyerTokenAddress, chainId);
              if (apiToken) {
                fetchedPropertyTokens.push(apiToken);
                console.log(`Fetched property from API: ${apiToken.shortName}`);
              }
            }
          }
          
          if (fetchedOffer.offerTokenType === 1) {
            const token = getPropertyToken(fetchedOffer.offerTokenAddress);
            if (token) {
              fetchedPropertyTokens.push(token);
            } else {
              // If not found locally, try fetching from API using the address
              console.log(`Property not found locally for offerToken ${fetchedOffer.offerTokenAddress}, fetching from API...`);
              const apiToken = await fetchPropertyByAddress(fetchedOffer.offerTokenAddress, chainId);
              if (apiToken) {
                fetchedPropertyTokens.push(apiToken);
                console.log(`Fetched property from API: ${apiToken.shortName}`);
              }
            }
          }
          
          // Also try to fetch property using the seller address (which is actually the token address/UUID)
          // This is important because the seller address is the token contract address
          if (fetchedOffer.sellerAddress && fetchedOffer.sellerAddress !== '0x0000000000000000000000000000000000000000') {
            const tokenBySeller = getPropertyToken(fetchedOffer.sellerAddress);
            if (tokenBySeller) {
              // Found in local cache
              if (!fetchedPropertyTokens.find(t => t.contractAddress === tokenBySeller.contractAddress)) {
                fetchedPropertyTokens.push(tokenBySeller);
                console.log(`Found property in cache using seller address: ${tokenBySeller.shortName}`);
              }
            } else {
              // Try fetching from API using the seller address (token contract address)
              console.log(`Trying to fetch property from API using seller address (token UUID): ${fetchedOffer.sellerAddress}`);
              const apiToken = await fetchPropertyByAddress(fetchedOffer.sellerAddress, chainId);
              if (apiToken && !fetchedPropertyTokens.find(t => t.contractAddress === apiToken.contractAddress)) {
                fetchedPropertyTokens.push(apiToken);
                console.log(`Fetched property from API using seller address: ${apiToken.shortName}`, {
                  annualYield: apiToken.annualYield,
                  officialPrice: apiToken.officialPrice,
                  currency: apiToken.currency,
                });
              } else {
                console.warn(`Could not fetch property from API for address: ${fetchedOffer.sellerAddress}`);
              }
            }
          }
          
          console.log(`Total property tokens found: ${fetchedPropertyTokens.length}`, {
            tokens: fetchedPropertyTokens.map(t => ({
              shortName: t.shortName,
              contractAddress: t.contractAddress,
              annualYield: t.annualYield,
              officialPrice: t.officialPrice,
            })),
          });
          
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

  // Note: Property tokens are now set directly in fetchOffer function
  // This useEffect was overwriting the API-fetched tokens with only local cache tokens
  // Removed to preserve the API-fetched tokens with annualYield and officialPrice

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
            <Grid gutter="md">
              {/* Left Column - Offer Details */}
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Stack gap="md">
                  {/* Offer ID Badge */}
                  <Badge size="lg" color="orange" variant="filled">
                    {offer.offerId}
                  </Badge>

                  <Stack gap="sm">
                    <Flex direction="column" gap={3}>
                      <Text fw={700}>Offer Token Name</Text>
                      <Text>{offer.offerTokenName}</Text>
                    </Flex>

                    <Flex direction="column" gap={3}>
                      <Text fw={700}>Seller Address</Text>
                      <Text style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>
                        {offer.buyerTokenAddress}
                      </Text>
                    </Flex>

                    <Flex direction="column" gap={3}>
                      <Text fw={700}>Token Smart Contract</Text>
                      <Text style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>
                        {offer.sellerAddress}
                      </Text>
                    </Flex>

                    <Flex direction="column" gap={3}>
                      <Text fw={700}>Quantity</Text>
                      <Text>
                        {(() => {
                          // The amount from the contract is in offerToken smallest units
                          // But we need to check if it's actually in buyerToken decimals
                          // If offerToken is USDC (6 decimals) but amount is large, it might be in buyerToken decimals (18)
                          const offerTokenDecimals = Number(offer.offerTokenDecimals || 18);
                          const buyerTokenDecimals = Number(offer.buyerTokenDecimals || 18);
                          const amountBN = new BigNumber(offer.amount);
                          
                          // Check if amount seems too large (suggests wrong decimals)
                          // If amount / 10^offerTokenDecimals > 1e12, likely using wrong decimals
                          const normalizedWithOfferDecimals = amountBN.shiftedBy(-offerTokenDecimals);
                          const normalizedWithBuyerDecimals = amountBN.shiftedBy(-buyerTokenDecimals);
                          
                          // Use buyerToken decimals if the amount seems unreasonably large
                          // (e.g., > 1 billion tokens suggests wrong decimal normalization)
                          const decimals = normalizedWithOfferDecimals.isGreaterThan(1e12) 
                            ? buyerTokenDecimals 
                            : offerTokenDecimals;
                          
                          const result = amountBN.shiftedBy(-decimals);
                          
                          console.log('Quantity calculation:', {
                            rawAmount: offer.amount,
                            offerTokenDecimals,
                            buyerTokenDecimals,
                            decimalsUsed: decimals,
                            normalizedWithOfferDecimals: normalizedWithOfferDecimals.toString(),
                            normalizedWithBuyerDecimals: normalizedWithBuyerDecimals.toString(),
                            result: result.toString(),
                          });
                          
                          return result.toFixed(4);
                        })()}
                      </Text>
                    </Flex>

                    <Flex direction="column" gap={3}>
                      <Text fw={700}>Price</Text>
                      {offer.price ? (
                        (() => {
                          // Check if buyerToken is USDC (or USD-pegged stablecoin)
                          const isBuyerTokenUSD = offer.buyerTokenName?.toUpperCase().includes('USDC') || 
                                                  offer.buyerTokenName?.toUpperCase().includes('USD') ||
                                                  offer.buyerTokenSymbol?.toUpperCase().includes('USDC') ||
                                                  offer.buyerTokenSymbol?.toUpperCase().includes('USD');
                          
                          // Check if offerToken is USDC
                          const isOfferTokenUSD = offer.offerTokenName?.toUpperCase().includes('USDC') || 
                                                  offer.offerTokenName?.toUpperCase().includes('USD') ||
                                                  offer.offerTokenSymbol?.toUpperCase().includes('USDC') ||
                                                  offer.offerTokenSymbol?.toUpperCase().includes('USD');
                          
                          const priceBN = new BigNumber(offer.price);
                          
                          // If buyerToken is USD/USDC, show price as "X USD per 1 offerToken"
                          if (isBuyerTokenUSD && !priceBN.isZero() && priceBN.isFinite()) {
                            return (
                              <Text>
                                {`${priceBN.toFixed(2)} USD`}
                              </Text>
                            );
                          }
                          
                          // If offerToken is USD/USDC, the price is already in USD per token
                          // No need to invert - priceBN is already the USD price
                          if (isOfferTokenUSD && !priceBN.isZero() && priceBN.isFinite()) {
                            return (
                              <Text>
                                {`${priceBN.toFixed(2)} USD`}
                              </Text>
                            );
                          }
                          
                          // If price is 0 or invalid, show error
                          if (priceBN.isZero() || priceBN.isNaN() || !priceBN.isFinite()) {
                            return (
                              <Text c="red" size="sm">
                                Invalid price: {offer.price}
                              </Text>
                            );
                          }
                          
                          // Fallback: show price as-is (shouldn't happen if one token is USD)
                          return (
                            <Text>
                              {`${priceBN.toFixed(2)} ${offer.buyerTokenName || 'tokens'}`}
                            </Text>
                          );
                        })()
                      ) : (
                        <Skeleton height={25} width={400} />
                      )}
                    </Flex>
                  </Stack>

                  <Divider />

                  <Flex justify="center">
                    <BuyActionsWithPermit
                      buyOffer={offer}
                      loading={isLoading}
                    />
                  </Flex>
                </Stack>
              </Grid.Col>

              {/* Right Column - Property Card */}
              <Grid.Col span={{ base: 12, md: 6 }}>
                {propertyTokens.length > 0 ? (
                  propertyTokens.map((token) => {
                    console.log('Property token data:', {
                      shortName: token.shortName,
                      annualYield: token.annualYield,
                      officialPrice: token.officialPrice,
                      currency: token.currency,
                      contractAddress: token.contractAddress,
                    });
                    
                    return (
                      <Stack gap="md" key={token.contractAddress}>
                        {/* Display Yield and Original Price */}
                        <Card withBorder p="md">
                          <Stack gap="sm">
                            <Flex justify="space-between" align="center">
                              <Text fw={700}>Yield:</Text>
                              <Text>
                                {token.annualYield !== undefined && token.annualYield !== null
                                  ? `${(token.annualYield * 100).toFixed(2)}%`
                                  : 'N/A'}
                              </Text>
                            </Flex>
                            <Flex justify="space-between" align="center">
                              <Text fw={700}>Original Token Price:</Text>
                              <Text>
                                {token.officialPrice !== undefined && token.officialPrice !== null
                                  ? `${token.officialPrice} ${token.currency || 'USD'}`
                                  : 'N/A'}
                              </Text>
                            </Flex>
                          </Stack>
                        </Card>
                        
                        <PropertyCard
                          propertyToken={token}
                          offer={offer}
                        />
                      </Stack>
                    );
                  })
                ) : (
                  <Card withBorder p="md">
                    <Stack gap="sm">
                      <Text c="dimmed">No property information available for this offer</Text>
                      <Text size="sm" c="dimmed">
                        Property tokens: {propertyTokens.length}
                      </Text>
                      <Text size="sm" c="dimmed">
                        Offer token type: {offer.offerTokenType}, Buyer token type: {offer.buyerTokenType}
                      </Text>
                      <Text size="sm" c="dimmed">
                        Offer token address: {offer.offerTokenAddress}
                      </Text>
                      <Text size="sm" c="dimmed">
                        Buyer token address: {offer.buyerTokenAddress}
                      </Text>
                    </Stack>
                  </Card>
                )}
              </Grid.Col>
            </Grid>
          )}
        </Stack>
      </Container>
  );
};

export default ViewOfferPage;

