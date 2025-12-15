import { useState, useEffect, useMemo, useCallback } from 'react';
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
import { IconSearch, IconAlertCircle, IconInfoCircle, IconTrash } from '@tabler/icons';
import { useTranslation } from 'react-i18next';
import BigNumber from 'bignumber.js';

import { fetchOfferRpc } from 'src/utils/rpc/fetchOfferRpc';
import { usePropertiesToken } from 'src/hooks/usePropertiesToken';
import { usePrices } from 'src/hooks/interface/usePrices';
import { useWlProperties } from 'src/hooks/interface/useWlProperties';
import { Offer } from 'src/types/offer/Offer';
import { OFFER_TYPE } from 'src/types/offer/OfferType';
import { PropertyCard } from 'src/components/Offer/PropertyCard/PropertyCard';
import { BuyActionsWithPermit } from 'src/components/Market/BuyActions/BuyActionsWithPermit';
import { OfferText } from 'src/components/Offer/OfferText';
// Removed client-side fetchPropertyByAddress - now using server-side API
import { PropertiesToken } from 'src/types/PropertiesToken';
import { useModals } from '@mantine/modals';

// Cache chainId to avoid repeated RPC calls
let cachedChainId: number | undefined = undefined;

const ViewOfferPage = () => {
  const router = useRouter();
  const { account, provider, chainId } = useWeb3React();
  const { t } = useTranslation('modals', { keyPrefix: 'buy' });
  
  // Use cached chainId if available, otherwise use the one from useWeb3React
  // This prevents unnecessary RPC calls when chainId hasn't actually changed
  const effectiveChainId = chainId || cachedChainId;
  
  // Update cache when chainId changes
  useEffect(() => {
    if (chainId) {
      cachedChainId = chainId;
    }
  }, [chainId]);
  
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
      if (!effectiveChainId) console.log('Waiting for chainId...');
      if (!provider) console.log('Waiting for provider...');
      if (!account) console.log('Waiting for account...');
      if (!propertiesToken) console.log('Waiting for propertiesToken...');
      if (!prices) console.log('Waiting for prices...');
      if (!wlProperties) console.log('Waiting for wlProperties...');
      
      // wlProperties is optional - only used for accountWhitelisted flag
      if (!effectiveChainId || !provider || !account || !propertiesToken || !prices) {
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
        console.log('Fetching offer with chainId:', effectiveChainId, 'offerId:', id);
        
        if (!effectiveChainId) {
          setError('No chain ID detected. Please connect your wallet and switch to the correct network.');
          setIsLoading(false);
          return;
        }
        
        // wlProperties is optional - pass empty array if not loaded yet
        const fetchedOffer = await fetchOfferRpc(
          provider,
          account,
          effectiveChainId,
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
          
          console.log('Fetching property tokens:', {
            buyerTokenAddress: fetchedOffer.buyerTokenAddress,
            buyerTokenType: fetchedOffer.buyerTokenType,
            offerTokenAddress: fetchedOffer.offerTokenAddress,
            offerTokenType: fetchedOffer.offerTokenType,
          });
          
          // Try to fetch property for buyerToken (even if type is not 1, as it might be a property token)
          const buyerTokenProperty = getPropertyToken(fetchedOffer.buyerTokenAddress);
          if (buyerTokenProperty) {
            console.log(`Found buyerToken property in cache: ${buyerTokenProperty.shortName}`);
            fetchedPropertyTokens.push(buyerTokenProperty);
          } else if (fetchedOffer.buyerTokenType === 1) {
            // If not found locally and type is 1, try fetching from server-side API
            console.log(`Property not found locally for buyerToken ${fetchedOffer.buyerTokenAddress} (type ${fetchedOffer.buyerTokenType}), fetching from API...`);
            try {
              const response = await fetch(`/api/property/${effectiveChainId}/${fetchedOffer.buyerTokenAddress}`);
              if (response.ok) {
                const apiToken = await response.json();
                fetchedPropertyTokens.push(apiToken);
                console.log(`Fetched buyerToken property from API: ${apiToken.shortName}`);
              } else {
                console.warn(`API returned ${response.status} for buyerToken ${fetchedOffer.buyerTokenAddress}`);
              }
            } catch (error) {
              console.warn(`Failed to fetch property from API for buyerToken ${fetchedOffer.buyerTokenAddress}:`, error);
            }
          } else {
            // Even if type is not 1, try fetching from API (might be a property token not registered correctly)
            console.log(`Trying to fetch property for buyerToken ${fetchedOffer.buyerTokenAddress} even though type is ${fetchedOffer.buyerTokenType}...`);
            try {
              const response = await fetch(`/api/property/${effectiveChainId}/${fetchedOffer.buyerTokenAddress}`);
              if (response.ok) {
                const apiToken = await response.json();
                fetchedPropertyTokens.push(apiToken);
                console.log(`Fetched buyerToken property from API (non-type-1): ${apiToken.shortName}`);
              }
            } catch (error) {
              // Silently fail - not all tokens are property tokens
            }
          }
          
          // Try to fetch property for offerToken (even if type is not 1, as it might be a property token)
          const offerTokenProperty = getPropertyToken(fetchedOffer.offerTokenAddress);
          if (offerTokenProperty) {
            console.log(`Found offerToken property in cache: ${offerTokenProperty.shortName}`);
            if (!fetchedPropertyTokens.find(t => t.contractAddress === offerTokenProperty.contractAddress)) {
              fetchedPropertyTokens.push(offerTokenProperty);
            }
          } else if (fetchedOffer.offerTokenType === 1) {
            // If not found locally and type is 1, try fetching from server-side API
            console.log(`Property not found locally for offerToken ${fetchedOffer.offerTokenAddress} (type ${fetchedOffer.offerTokenType}), fetching from API...`);
            try {
              const response = await fetch(`/api/property/${effectiveChainId}/${fetchedOffer.offerTokenAddress}`);
              if (response.ok) {
                const apiToken = await response.json();
                if (!fetchedPropertyTokens.find(t => t.contractAddress === apiToken.contractAddress)) {
                  fetchedPropertyTokens.push(apiToken);
                  console.log(`Fetched offerToken property from API: ${apiToken.shortName}`);
                }
              } else {
                console.warn(`API returned ${response.status} for offerToken ${fetchedOffer.offerTokenAddress}`);
              }
            } catch (error) {
              console.warn(`Failed to fetch property from API for offerToken ${fetchedOffer.offerTokenAddress}:`, error);
            }
          } else {
            // Even if type is not 1, try fetching from API (might be a property token not registered correctly)
            console.log(`Trying to fetch property for offerToken ${fetchedOffer.offerTokenAddress} even though type is ${fetchedOffer.offerTokenType}...`);
            try {
              const response = await fetch(`/api/property/${effectiveChainId}/${fetchedOffer.offerTokenAddress}`);
              if (response.ok) {
                const apiToken = await response.json();
                if (!fetchedPropertyTokens.find(t => t.contractAddress === apiToken.contractAddress)) {
                  fetchedPropertyTokens.push(apiToken);
                  console.log(`Fetched offerToken property from API (non-type-1): ${apiToken.shortName}`);
                }
              }
            } catch (error) {
              // Silently fail - not all tokens are property tokens
            }
          }
          
          // Note: sellerAddress is the wallet address, not a token contract address
          // We should only use offerTokenAddress and buyerTokenAddress for property lookups
          
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
    if (offerId && effectiveChainId && provider && account && propertiesToken && prices) {
      fetchOffer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId, effectiveChainId, provider, account, propertiesToken, prices]);

  // Note: Property tokens are now set directly in fetchOffer function
  // This useEffect was overwriting the API-fetched tokens with only local cache tokens
  // Removed to preserve the API-fetched tokens with annualYield and officialPrice

  const handleSearch = async () => {
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
    
    // Force fetch by clearing and resetting offerId to trigger useEffect
    // This ensures the fetch runs even if the offerId value hasn't changed
    setOffer(undefined);
    setError(null);
    
    // The useEffect will handle the fetch when dependencies are ready
    // But we can also trigger it directly if all dependencies are available
    if (effectiveChainId && provider && account && propertiesToken && prices) {
      setIsLoading(true);
      try {
        console.log('Fetching offer with chainId:', effectiveChainId, 'offerId:', id);
        
        const fetchedOffer = await fetchOfferRpc(
          provider,
          account,
          effectiveChainId,
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
          
          console.log('Fetching property tokens:', {
            buyerTokenAddress: fetchedOffer.buyerTokenAddress,
            buyerTokenType: fetchedOffer.buyerTokenType,
            offerTokenAddress: fetchedOffer.offerTokenAddress,
            offerTokenType: fetchedOffer.offerTokenType,
          });
          
          // Try to fetch property for buyerToken
          const buyerTokenProperty = getPropertyToken(fetchedOffer.buyerTokenAddress);
          if (buyerTokenProperty) {
            console.log(`Found buyerToken property in cache: ${buyerTokenProperty.shortName}`);
            fetchedPropertyTokens.push(buyerTokenProperty);
          } else {
            console.log(`Property not found locally for buyerToken ${fetchedOffer.buyerTokenAddress}, fetching from API...`);
            try {
              const response = await fetch(`/api/property/${effectiveChainId}/${fetchedOffer.buyerTokenAddress}`);
              if (response.ok) {
                const apiToken = await response.json();
                console.log(`Successfully fetched buyerToken property from API: ${apiToken.shortName}`);
                fetchedPropertyTokens.push(apiToken);
              } else {
                console.warn(`Failed to fetch buyerToken property from API: ${response.status}`);
              }
            } catch (apiError) {
              console.error('Error fetching buyerToken property from API:', apiError);
            }
          }
          
          // Try to fetch property for offerToken (for exchange offers)
          const offerTokenProperty = getPropertyToken(fetchedOffer.offerTokenAddress);
          if (offerTokenProperty) {
            console.log(`Found offerToken property in cache: ${offerTokenProperty.shortName}`);
            // Only add if it's different from buyerToken
            if (offerTokenProperty.contractAddress.toLowerCase() !== fetchedOffer.buyerTokenAddress.toLowerCase()) {
              fetchedPropertyTokens.push(offerTokenProperty);
            }
          } else if (fetchedOffer.offerTokenType === 1) {
            console.log(`Property not found locally for offerToken ${fetchedOffer.offerTokenAddress}, fetching from API...`);
            try {
              const response = await fetch(`/api/property/${effectiveChainId}/${fetchedOffer.offerTokenAddress}`);
              if (response.ok) {
                const apiToken = await response.json();
                console.log(`Successfully fetched offerToken property from API: ${apiToken.shortName}`);
                // Only add if it's different from buyerToken
                if (apiToken.contractAddress.toLowerCase() !== fetchedOffer.buyerTokenAddress.toLowerCase()) {
                  fetchedPropertyTokens.push(apiToken);
                }
              } else {
                console.warn(`Failed to fetch offerToken property from API: ${response.status}`);
              }
            } catch (apiError) {
              console.error('Error fetching offerToken property from API:', apiError);
            }
          }
          
          setPropertyTokens(fetchedPropertyTokens);
        } else {
          setError('Offer not found. Please check the offer ID and ensure you are connected to the correct network.');
          setOffer(undefined);
        }
      } catch (err: any) {
        console.error('Error fetching offer:', err);
        setError(err?.message || 'Failed to fetch offer. Please try again.');
        setOffer(undefined);
      } finally {
        setIsLoading(false);
      }
    } else {
      // If dependencies aren't ready, the useEffect will handle it
      console.log('Dependencies not ready, useEffect will handle fetch when ready');
    }
  };

  const isAccountOffer = useMemo(() => {
    if (!offer || !account) {
      return false;
    }
    const accountLower = account.toLowerCase();
    
    // Check all address fields to see which one matches
    // The seller address should be the wallet address of the person who created the offer
    const sellerAddressLower = (offer.sellerAddress || '').toLowerCase();
    const buyerAddressLower = (offer.buyerAddress || '').toLowerCase();
    const offerTokenAddressLower = (offer.offerTokenAddress || '').toLowerCase();
    const buyerTokenAddressLower = (offer.buyerTokenAddress || '').toLowerCase();
    
    // Check each field
    const isSellerMatch = sellerAddressLower === accountLower;
    const isBuyerMatch = buyerAddressLower === accountLower;
    const isOfferTokenMatch = offerTokenAddressLower === accountLower;
    const isBuyerTokenMatch = buyerTokenAddressLower === accountLower;
    
    // Log all addresses for debugging
    console.log('isAccountOffer check - all addresses:', {
      account,
      accountLower,
      sellerAddress: offer.sellerAddress,
      sellerAddressLower,
      buyerAddress: offer.buyerAddress,
      buyerAddressLower,
      offerTokenAddress: offer.offerTokenAddress,
      buyerTokenAddress: offer.buyerTokenAddress,
      matches: {
        seller: isSellerMatch,
        buyer: isBuyerMatch,
        offerToken: isOfferTokenMatch,
        buyerToken: isBuyerTokenMatch,
      },
      offerId: offer.offerId,
    });
    
    // Check if either seller or buyer matches the account
    // The seller is the person who created the offer, so they can delete it
    // For private offers, the buyer might also be able to delete, but typically only seller can delete
    // Return true if seller matches (seller is the offer creator)
    return isSellerMatch;
  }, [offer, account]);

  const isConnected = !!account && !!provider && !!effectiveChainId;
  
  const modals = useModals();
  const { t: tModals } = useTranslation('modals');
  
  // Handle delete success - clear offer and redirect
  const handleDeleteSuccess = useCallback(() => {
    setOffer(undefined);
    setOfferId('');
    setError(null);
    router.push('/view-offer', undefined, { shallow: true });
  }, [router]);
  
  // Open delete modal for this offer
  const handleDeleteOffer = useCallback(() => {
    if (!offer) return;
    
    modals.openContextModal('delete', {
      title: <Title order={3}>{tModals('delete.title')}</Title>,
      size: "lg",
      innerProps: {
        offerIds: [offer.offerId],
        onSuccess: handleDeleteSuccess,
      },
    });
  }, [modals, offer, tModals, handleDeleteSuccess]);

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
            
            {isConnected && effectiveChainId && (
              <Alert icon={<IconInfoCircle size={16} />} color="green" variant="light">
                Connected to chain {effectiveChainId}. Ready to fetch offer {offerId || '(enter ID above)'}
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
              <Grid gutter={{ base: 'md', md: 'xl' }}>
                {/* Left Column - Offer Details */}
                <Grid.Col span={{ base: 12, md: 5 }} style={{ paddingRight: '3rem' }}>
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
                        {offer.sellerAddress}
                      </Text>
                    </Flex>

                    <Flex direction="column" gap={3}>
                      <Text fw={700}>Token Smart Contract</Text>
                      <Text style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>
                        {offer.buyerTokenAddress}
                      </Text>
                    </Flex>

                    <Flex direction="column" gap={3}>
                      <Text fw={700}>Quantity</Text>
                      <Text>
                        {(() => {
                          try {
                            // The amount from the contract represents how much buyerToken is being sold
                            // Quantity represents how much buyerToken the buyer will receive
                            
                            // Ensure amount is a string or number
                            const amountStr = offer.amount?.toString() || '0';
                            if (!amountStr || amountStr === '0') {
                              return '0';
                            }
                            
                            const amountBN = new BigNumber(amountStr);
                            
                            // Determine which decimals to use based on offer type
                            // For exchange offers, we might need to use offerTokenDecimals
                            // But typically, amount represents buyerToken quantity
                            let decimals = Number(offer.buyerTokenDecimals);
                            
                            // If buyerTokenDecimals is invalid, try offerTokenDecimals
                            if (isNaN(decimals) || decimals <= 0 || decimals > 18) {
                              decimals = Number(offer.offerTokenDecimals);
                            }
                            
                            // If still invalid, default to 18
                            if (isNaN(decimals) || decimals <= 0 || decimals > 18) {
                              console.warn('Invalid decimals, using default 18. buyerTokenDecimals:', offer.buyerTokenDecimals, 'offerTokenDecimals:', offer.offerTokenDecimals);
                              decimals = 18;
                            }
                            
                            // Use decimals to normalize the amount
                            const result = amountBN.shiftedBy(-decimals);
                            
                            // Format with up to 4 decimal places, removing trailing zeros
                            const formatted = result.toFixed(4).replace(/\.?0+$/, '');
                            
                            // Log for debugging
                            console.log('Quantity calculation:', {
                              rawAmount: amountStr,
                              decimals: decimals,
                              result: result.toString(),
                              formatted: formatted,
                            });
                            
                            return formatted;
                          } catch (error) {
                            console.error('Error calculating quantity:', error, {
                              amount: offer.amount,
                              buyerTokenDecimals: offer.buyerTokenDecimals,
                              offerTokenDecimals: offer.offerTokenDecimals,
                            });
                            return '0';
                          }
                        })()}
                      </Text>
                    </Flex>

                    <Flex direction="column" gap={3}>
                      <Text fw={700}>Price</Text>
                      {offer.price ? (
                        (() => {
                          // Check if buyerToken is USDC (or USD-pegged stablecoin)
                          const isBuyerTokenUSD = offer.buyerTokenName?.toUpperCase().includes('USDC') || 
                                                  offer.buyerTokenName?.toUpperCase().includes('USD');
                          
                          // Check if offerToken is USDC
                          const isOfferTokenUSD = offer.offerTokenName?.toUpperCase().includes('USDC') || 
                                                  offer.offerTokenName?.toUpperCase().includes('USD');
                          
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

                    {(() => {
                      // Debug: log priceDelta and officialPrice
                      console.log('Price difference debug:', {
                        priceDelta: offer.priceDelta,
                        officialPrice: offer.officialPrice,
                        offerPrice: offer.offerPrice,
                        price: offer.price,
                        type: offer.type,
                        buyCurrency: offer.buyCurrency,
                        propertyTokens: propertyTokens.map(t => ({
                          address: t.contractAddress,
                          officialPrice: t.officialPrice,
                        })),
                      });

                      // Try to calculate priceDelta if not available
                      let priceDelta = offer.priceDelta;
                      let officialPrice = offer.officialPrice;

                      // Check if officialPrice is valid (not undefined and > 0)
                      const hasValidOfficialPrice = officialPrice !== undefined && officialPrice > 0;

                      // Try to get officialPrice from propertyTokens if not valid
                      if (!hasValidOfficialPrice && propertyTokens.length > 0) {
                        // For EXCHANGE offers, check both tokens
                        if (offer.type === OFFER_TYPE.EXCHANGE) {
                          // Try buyerToken first
                          const buyerTokenProperty = propertyTokens.find(
                            t => t.contractAddress?.toLowerCase() === offer.buyerTokenAddress?.toLowerCase()
                          );
                          if (buyerTokenProperty?.officialPrice && buyerTokenProperty.officialPrice > 0) {
                            officialPrice = buyerTokenProperty.officialPrice;
                          } else {
                            // Try offerToken
                            const offerTokenProperty = propertyTokens.find(
                              t => t.contractAddress?.toLowerCase() === offer.offerTokenAddress?.toLowerCase()
                            );
                            if (offerTokenProperty?.officialPrice && offerTokenProperty.officialPrice > 0) {
                              officialPrice = offerTokenProperty.officialPrice;
                            }
                          }
                        } else {
                          // For SELL/BUY, check the appropriate token
                          const propertyToken = propertyTokens.find(
                            t => t.contractAddress?.toLowerCase() === 
                              (offer.type === OFFER_TYPE.BUY
                                ? offer.buyerTokenAddress?.toLowerCase() 
                                : offer.offerTokenAddress?.toLowerCase())
                          );
                          if (propertyToken?.officialPrice && propertyToken.officialPrice > 0) {
                            officialPrice = propertyToken.officialPrice;
                          }
                        }
                      }

                      // Calculate offerPrice if not available
                      let offerPrice = offer.offerPrice;
                      if (offerPrice === undefined && offer.price && prices) {
                        if (offer.type === OFFER_TYPE.SELL) {
                          const buyTokenPriceInDollar = parseFloat(prices[offer.buyerTokenAddress?.toLowerCase()] || '0');
                          if (buyTokenPriceInDollar > 0) {
                            offerPrice = buyTokenPriceInDollar * parseFloat(offer.price);
                          }
                        } else if (offer.type === OFFER_TYPE.BUY) {
                          offerPrice = 1 / parseFloat(offer.price);
                        } else if (offer.type === OFFER_TYPE.EXCHANGE) {
                          // For EXCHANGE, try to calculate based on which token is the property token
                          const buyerTokenPrice = parseFloat(prices[offer.buyerTokenAddress?.toLowerCase()] || '0');
                          const offerTokenPrice = parseFloat(prices[offer.offerTokenAddress?.toLowerCase()] || '0');
                          
                          // If buyerToken has a price, calculate offerPrice as buyerTokenPrice * price
                          if (buyerTokenPrice > 0) {
                            offerPrice = buyerTokenPrice * parseFloat(offer.price);
                          } else if (offerTokenPrice > 0) {
                            // If offerToken has a price, calculate as offerTokenPrice / price
                            offerPrice = offerTokenPrice / parseFloat(offer.price);
                          }
                        }
                      }

                      // Calculate priceDelta if not available but we have valid officialPrice and offerPrice
                      if (priceDelta === undefined && officialPrice !== undefined && officialPrice > 0 && offerPrice !== undefined && offerPrice > 0) {
                        if (offer.type === OFFER_TYPE.SELL || offer.type === OFFER_TYPE.EXCHANGE) {
                          // For SELL/EXCHANGE: priceDelta = (offerPrice / officialPrice) - 1
                          priceDelta = (offerPrice / officialPrice) - 1;
                        } else if (offer.type === OFFER_TYPE.BUY) {
                          // For BUY: priceDelta = (1/price - officialPrice) / officialPrice
                          const tokenInDollar = 1 / parseFloat(offer.price);
                          priceDelta = (tokenInDollar - officialPrice) / officialPrice;
                        }
                      }

                      // Only show if we have both valid values
                      if (officialPrice !== undefined && officialPrice > 0 && priceDelta !== undefined) {
                        return (
                          <Flex direction="column" gap={3}>
                            <Text fw={700}>Price Difference</Text>
                            <Flex direction="column" gap={2}>
                              <Text c={priceDelta > 0 ? "red" : priceDelta < 0 ? "green" : "dimmed"}>
                                {priceDelta > 0 ? "+" : ""}{(priceDelta * 100).toFixed(2)}%
                              </Text>
                              <Text size="sm" c="dimmed">
                                Official price: {officialPrice.toFixed(2)} {offer.buyCurrency || 'USD'}
                              </Text>
                            </Flex>
                          </Flex>
                        );
                      }
                      return null;
                    })()}
                  </Stack>

                  <Divider />

                  <Flex justify="center" gap="md" direction="column" align="center">
                    {isAccountOffer ? (
                      <Button
                        color="red"
                        variant="filled"
                        onClick={handleDeleteOffer}
                        leftSection={<IconTrash size={16} />}
                      >
                        Delete Offer
                      </Button>
                    ) : null}
                    <BuyActionsWithPermit
                      buyOffer={offer}
                      loading={isLoading}
                    />
                  </Flex>
                </Stack>
              </Grid.Col>

                {/* Right Column - Property Card */}
                <Grid.Col span={{ base: 12, md: 7 }} style={{ paddingLeft: '3rem' }}>
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
                      <PropertyCard
                        key={token.contractAddress}
                        propertyToken={token}
                        offer={{
                          ...offer,
                          // Ensure offerPrice and offerYield are set for the comparison table
                          offerPrice: offer.offerPrice || (offer.price ? parseFloat(offer.price) : undefined),
                          offerYield: (() => {
                            // Calculate new yield based on offer price
                            // Formula: (netRentYearPerToken / offerPrice) * 100
                            if (token.netRentYearPerToken && offer.price) {
                              const offerPriceBN = new BigNumber(offer.price);
                              if (!offerPriceBN.isZero() && offerPriceBN.isFinite()) {
                                const netRentBN = new BigNumber(token.netRentYearPerToken);
                                const newYield = netRentBN.dividedBy(offerPriceBN).multipliedBy(100);
                                return parseFloat(newYield.toString());
                              }
                            }
                            // Fallback to offer.offerYield if available
                            return offer.offerYield || undefined;
                          })(),
                        }}
                      />
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

