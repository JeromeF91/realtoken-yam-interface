import {
  Dispatch,
  FC,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Web3Provider } from '@ethersproject/providers';
import { Button, Divider, Flex, Stack, Text, Tooltip, SegmentedControl } from '@mantine/core';
import { useForm } from '@mantine/form';
import { ContextModalProps } from '@mantine/modals';
import BigNumber from 'bignumber.js';
import { ContractsID } from 'src/constants';
import { useActiveChain, useContract } from 'src/hooks';
import { getContract } from 'src/utils';
import { NumberInput } from '../../NumberInput';
import { useWalletERC20Balance } from 'src/hooks/useWalletERC20Balance';
import { cleanNumber } from 'src/utils/number';
import { useWeb3React } from '@web3-react/core';
import { calcRem } from 'src/utils/style';
import { useERC20TokenInfo } from 'src/hooks/useERC20TokenInfo';
import { Offer, OFFER_TYPE } from 'src/types/offer';
import { useAtomValue } from 'jotai';
import { providerAtom } from 'src/states';
import { BUY_METHODS, buy } from '../../../utils/tx/buy';
import { Erc20, Erc20ABI } from '../../../abis';
import { AvailableConnectors, ConnectorsDatas } from '@realtoken/realt-commons';
import { useApproveOffer } from '../../../hooks/useApproveOffer';
import { usePropertyToken } from 'src/hooks/usePropertyToken';
import { usePropertiesToken } from 'src/hooks/usePropertiesToken';
import { getPropertyTokenAddress } from 'src/utils/properties';

type BuyModalWithPermitProps = {
  offer: Offer,
  triggerTableRefresh: Dispatch<SetStateAction<boolean>>;
};

type BuyWithPermitFormValues = {
  offerId: string;
  price: number;
  amount: number;
  offerTokenAddress: string;
  offerTokenDecimals: number;
  buyerTokenAddress: string;
  buyerTokenDecimals: number;
  buyMethod?: BUY_METHODS;
};

export const BuyModalWithPermit: FC<
  ContextModalProps<BuyModalWithPermitProps>
> =  ({
  context,
  id,
  innerProps: {
    offer,
    triggerTableRefresh,
  },
}) => {

  const { account, provider } = useWeb3React();

  const { getInputProps, onSubmit, reset, setFieldValue, values } = useForm<BuyWithPermitFormValues>({
    // eslint-disable-next-line object-shorthand
    initialValues: {
      offerId: offer.offerId,
      price: parseFloat(offer.price),
      amount: 0,
      offerTokenAddress: offer.offerTokenAddress,
      offerTokenDecimals: parseFloat(offer.offerTokenDecimals),
      buyerTokenAddress: offer.buyerTokenAddress,
      buyerTokenDecimals: parseFloat(offer.buyerTokenDecimals),
      buyMethod: BUY_METHODS.buyWithApprove,
    },
  });

  const [isSubmitting, setSubmitting] = useState<boolean>(false);
  const activeChain = useActiveChain();
  
  // Use token info from offer object instead of making RPC calls
  // The offer already contains offerTokenName, offerTokenDecimals, buyerTokenName, buyerTokenDecimals
  // Only fetch symbol if name is not available or looks like an address
  const offerTokenName = offer.offerTokenName;
  const offerTokenSymbol = offer.offerTokenName || 'USDC'; // Use name as symbol, default to USDC for offerToken
  const buyTokenSymbol = offer.buyerTokenName; // Use name as symbol fallback
  
  // Get property token info - when buying, we're buying the buyerToken (property token)
  // The buyerTokenAddress is the property token contract address
  // Try buyerTokenAddress first (this is the property token when buying)
  const { propertyToken: buyerPropertyTokenFromBuyerToken } = usePropertyToken(offer.buyerTokenAddress);
  // Also try offerTokenAddress in case it's a property token (for exchange offers)
  const { propertyToken: buyerPropertyTokenFromOfferToken } = usePropertyToken(offer.offerTokenAddress);
  // Use whichever one is found, prefer buyerTokenAddress
  const buyerPropertyToken = buyerPropertyTokenFromBuyerToken || buyerPropertyTokenFromOfferToken;
  const { propertiesIsloading } = usePropertiesToken();
  
  // Use property token short name if available, otherwise fall back to symbol
  const buyerTokenDisplayName = useMemo(() => {
    // First priority: property token short name
    if (buyerPropertyToken?.shortName) {
      return buyerPropertyToken.shortName;
    }
    
    // Second priority: buyTokenSymbol if it's not an address-like value
    if (buyTokenSymbol && 
        buyTokenSymbol !== '0X7FBB' && 
        !buyTokenSymbol.match(/^0x[a-fA-F0-9]{4,}$/i) && 
        buyTokenSymbol.length < 20) {
      return buyTokenSymbol;
    }
    
    // Third priority: buyerTokenName if it's not an address-like value
    if (offer.buyerTokenName && 
        offer.buyerTokenName !== '0X7FBB' && 
        !offer.buyerTokenName.match(/^0x[a-fA-F0-9]{4,}$/i) && 
        offer.buyerTokenName.length < 20) {
      return offer.buyerTokenName;
    }
    
    // Last resort: return a formatted address (but only if properties have loaded)
    if (!propertiesIsloading) {
      return `${offer.buyerTokenAddress.slice(0, 6)}...${offer.buyerTokenAddress.slice(-4)}`;
    }
    
    // While loading, show a placeholder
    return buyTokenSymbol || 'Loading...';
  }, [buyerPropertyToken, buyTokenSymbol, offer.buyerTokenAddress, offer.buyerTokenName, propertiesIsloading]);
  
  const realTokenYamUpgradeable = useContract(
    ContractsID.realTokenYamUpgradeable
  );
  
  // Removed getOfferTokenInfos - seller balance is not needed for buying
  // The offer already contains availableAmount which is what matters

  const { t } = useTranslation('modals', { keyPrefix: 'buy' });
  const { t: t1 } = useTranslation('modals', { keyPrefix: 'sell' });

  const onClose = useCallback(() => {
    reset();
    context.closeModal(id);
  }, [context, id, reset]);

  // Note: offerToken and buyerToken are reversed in naming
  // When buying, you pay with offerToken, so we need to check the balance of offerToken
  // Pass decimals and symbol from offer to avoid RPC calls
  const { balance, WalletERC20Balance, bigNumberbalance } = useWalletERC20Balance(
    offer.offerTokenAddress,
    offer.offerTokenDecimals,
    offerTokenSymbol
  )

  // Get current allowance for the payment token (offerToken) to calculate max quantity
  const [allowanceBN, setAllowanceBN] = useState<BigNumber | undefined>(undefined);
  useEffect(() => {
    const fetchAllowance = async () => {
      if (!account || !provider || !offer.offerTokenAddress || !realTokenYamUpgradeable) {
        return;
      }
      
      try {
        const Erc20Contract = getContract<Erc20>(
          offer.offerTokenAddress,
          Erc20ABI,
          provider as Web3Provider,
          account
        );
        
        if (Erc20Contract) {
          const allowance = await Erc20Contract.callStatic.allowance(
            account,
            realTokenYamUpgradeable.address
          );
          setAllowanceBN(new BigNumber(allowance.toString()));
        }
      } catch (error: any) {
        console.warn('Failed to fetch allowance for max calculation:', error?.message);
        // If allowance call fails, set to 0 (user will need to approve)
        setAllowanceBN(new BigNumber(0));
      }
    };
    
    fetchAllowance();
  }, [account, provider, offer.offerTokenAddress, realTokenYamUpgradeable]);

  const total = values?.amount * values?.price;

  const connector = useAtomValue(providerAtom);

  const onHandleSubmit = useCallback(
    async (formValues: BuyWithPermitFormValues) => {

      const onFinished = () => {
        onClose();
        triggerTableRefresh(true);
      }
      
      buy(
        account,
        provider,
        activeChain,
        realTokenYamUpgradeable,
        offer,
        formValues.amount,
        connector,
        setSubmitting,
        onFinished,
        formValues.buyMethod
      );
    },
    [account, provider, activeChain, realTokenYamUpgradeable, offer, connector, onClose, triggerTableRefresh]
  );

  const maxTokenBuy: number|undefined = useMemo(() => {
    if(!balance || !offer.price) return undefined;

    const priceBN = new BigNumber(offer.price);
    const offerTokenDecimals = Number(offer.offerTokenDecimals || 18);
    const buyerTokenDecimals = Number(offer.buyerTokenDecimals || 18);
    
    // 1. Max from offer: offer.amount is in buyerToken wei, convert to human-readable
    const offerAmountBN = new BigNumber(offer.amount);
    const maxFromOffer = offerAmountBN.shiftedBy(-buyerTokenDecimals);
    
    // 2. Max from balance: balance is in human-readable format (offerToken)
    //    Calculate how much buyerToken we can buy: balance / price
    const balanceBN = new BigNumber(balance);
    const maxFromBalance = balanceBN.eq(0) ? new BigNumber(0) : balanceBN.dividedBy(priceBN);
    
    // 3. Max from allowance: allowanceBN is in offerToken wei
    //    Convert to human-readable, then divide by price
    let maxFromAllowance = new BigNumber(Infinity);
    if (allowanceBN !== undefined) {
      const allowanceHumanReadable = allowanceBN.shiftedBy(-offerTokenDecimals);
      maxFromAllowance = allowanceHumanReadable.eq(0) ? new BigNumber(0) : allowanceHumanReadable.dividedBy(priceBN);
    }
    
    // Max quantity = min(offer amount, balance/price, allowance/price)
    // All values are now in human-readable format (buyerToken quantity)
    const max = BigNumber.minimum(
      maxFromOffer,
      maxFromBalance,
      maxFromAllowance
    );
    
    console.log('Max quantity calculation:', {
      maxFromOffer: maxFromOffer.toString(),
      maxFromBalance: maxFromBalance.toString(),
      maxFromAllowance: maxFromAllowance.toString(),
      max: max.toString(),
      balance,
      allowance: allowanceBN?.toString(),
      price: offer.price,
    });
    
    return max.toNumber();
  },[balance, allowanceBN, offer]);

  const { approveNeeded, approve, approveLoading } = useApproveOffer(offer, values.amount);

  const priceTranslation: Map<OFFER_TYPE,string> = new Map<OFFER_TYPE,string>([
    [OFFER_TYPE.BUY,t("buyOfferTypePrice")],
    [OFFER_TYPE.SELL,t("sellOfferTypePrice")],
    [OFFER_TYPE.EXCHANGE,t("exchangeOfferTypePrice")]
  ]);

  const amountTranslation: Map<OFFER_TYPE,string> = new Map<OFFER_TYPE,string>([
    [OFFER_TYPE.BUY,t("buyOfferTypeAmount")],
    [OFFER_TYPE.SELL,t("sellOfferTypeAmount")],
    [OFFER_TYPE.EXCHANGE,t("exchangeOfferTypeAmount")]
  ]);

  return (
    <form onSubmit={onSubmit(onHandleSubmit)} style={{ paddingBottom: calcRem(40) }}>
      <Stack justify={'center'} align={'stretch'}>
        <Flex direction={"column"} gap={"sm"}>
          <Text size={"xl"}>{t('selectedOffer')}</Text>
          <Flex direction={"column"} gap={8}>
              <Flex direction={"column"}>
                <Text fw={700}>{t("offerId")}</Text>
                <Text>{offer.offerId}</Text>
              </Flex>
              <Flex direction={"column"}>
                <Text fw={700}>{t("offerTokenName")}</Text>
                <Text>{offerTokenName}</Text>
              </Flex>
              <Flex direction={"column"}>
                <Text fw={700}>{t("sellerAddress")}</Text>
                <Text>{offer.sellerAddress}</Text>
              </Flex>
              <Flex direction={"column"} >
                <Text fw={700}>{offer.type ? amountTranslation.get(offer.type) : ""}</Text>
                <Text>{offer.availableAmount}</Text>
              </Flex>
              <Flex direction={"column"}>
                  <Text fw={700}>{offer.type ? priceTranslation.get(offer.type) : ""}</Text>
                  {/* When buying, you pay with offerToken, so price should be shown in offerToken */}
                  <Text>{`${offer.price} ${offerTokenSymbol}`}</Text>
              </Flex>
          </Flex>
        </Flex>

        <Divider />

        <WalletERC20Balance />

        <Flex direction={"column"} gap={"sm"} >
          <Text size={"xl"}>{t1("sell")}</Text>
          <Flex direction={"column"} gap={8}>
            <NumberInput
              label={t('amount')}
              required={true}
              // disabled={maxTokenBuy == 0 || maxTokenBuy == undefined}
              min={0}
              max={maxTokenBuy}
              showMax={true}
              placeholder={t('amount')}
              style={{ flexGrow: 1 }}
              groupMarginBottom={16}
              setFieldValue={setFieldValue}
              {...getInputProps('amount')}
            />

            <Text size={"xl"}>{t("summary")}</Text>
            <Text size={"md"} mb={10}>
              {/* When buying: you're buying buyerToken (property token), paying with offerToken (USDC) */}
              {` ${t("summaryText1")} ${values?.amount} ${buyerTokenDisplayName} ${t("summaryText2")} ${cleanNumber(values?.price)} ${offerTokenSymbol} ${t("summaryText3")} ${total} ${offerTokenSymbol}`}
            </Text>
            
            {values.amount > 0 ? (
              <Flex direction={'column'} gap={'md'} style={(theme) => ({ marginBottom: theme.spacing.xl })}>
              {connector !== ConnectorsDatas.get(AvailableConnectors.gnosisSafe)?.connectorKey ? (
                <Flex direction={'column'} gap={5}>
                  <Text size="sm" fw={500} mt="md">{'Buy method'}</Text>
                  <SegmentedControl
                    data={[
                      {
                        value: BUY_METHODS.buyWithApprove,
                        label: (
                          <Tooltip label={t('buyButtons.approve.details')} multiline w={200}>
                            <span>{t('buyButtons.approve.options')}</span>
                          </Tooltip>
                        ),
                      },
                      {
                        value: BUY_METHODS.buyWithPermit,
                        label: (
                          <Tooltip label={t('buyButtons.permit.details')} multiline w={200}>
                            <span>{t('buyButtons.permit.options')}</span>
                          </Tooltip>
                        ),
                      },
                    ]}
                    {...getInputProps('buyMethod')}
                  />
                </Flex>
              ): undefined}
              {values.buyMethod == BUY_METHODS.buyWithApprove && approveNeeded ? (
                <Button
                  loading={approveLoading}
                  aria-label={t('confirm')}
                  onClick={() => approve()}
                >
                  {'Approve token'}
                </Button>
              ): undefined}
              <Button
                type={'submit'}
                loading={isSubmitting}
                aria-label={t('confirm')}
                disabled={values?.amount == 0 || !values.amount || values.buyMethod == BUY_METHODS.buyWithApprove && approveNeeded}
              >
                {values.buyMethod == BUY_METHODS.buyWithPermit ? t('buyButtons.permit.text') : t('buyButtons.approve.text')}
              </Button>
            </Flex>
            ) : undefined}

            <Flex>
              <Button color={'red'} onClick={onClose} aria-label={t('cancel')}>
                {t('cancel')}
              </Button>
            </Flex>
          </Flex>
        </Flex>
          
      </Stack>
    </form>
  );
};
