/* eslint-disable react/display-name */
import { FC, forwardRef, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Checkbox, Flex, Group, Select, SelectItem, Stack, TextInput, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { showNotification, updateNotification } from '@mantine/notifications';
import BigNumber from 'bignumber.js';
import { CoinBridgeToken, Erc20, Erc20ABI, coinBridgeTokenABI } from 'src/abis';
import { ContractsID, NOTIFICATIONS, NotificationsID } from 'src/constants';
import { ZERO_ADDRESS } from 'src/constants';
import { useActiveChain } from 'src/hooks';
import coinBridgeTokenPermitSignature from 'src/hooks/coinBridgeTokenPermitSignature';
import erc20PermitSignature from 'src/hooks/erc20PermitSignature';
import { useContract } from 'src/hooks/useContract';
import { getContract } from 'src/utils';
import { NumberInput } from '../../NumberInput';
import { usePropertiesToken } from 'src/hooks/usePropertiesToken';
import { PropertiesToken } from 'src/types/PropertiesToken';
import { cleanNumber } from 'src/utils/number';
import { useWeb3React } from '@web3-react/core';
import { ContextModalProps } from '@mantine/modals';
import { useAppDispatch, useAppSelector } from 'src/hooks/react-hooks';
import { createOfferAddedDispatchType } from 'src/store/features/createOffers/createOffersSlice';
import { CreatedOffer } from 'src/types/Offer/CreatedOffer';
import { selectCreateOffers } from 'src/store/features/createOffers/createOffersSelector';
import { useCreateOfferTokens } from 'src/hooks/useCreateOfferTokens';
import { OfferTypeBadge } from 'src/components/Offer/OfferTypeBadge';

interface ItemProps extends React.ComponentPropsWithoutRef<'div'> {
  label: string;
  uuid: string;
  value: string;
}

type CreateOfferModalProps = {
  offer: CreatedOffer
}

type SellFormValues = {
  offerTokenAddress: string;
  buyerTokenAddress: string;
  price: number|undefined;
  amount: number|undefined;
  buyerAddress: string;
  isPrivateOffer: boolean;
};

export const CreateOfferModal: FC<ContextModalProps<CreateOfferModalProps>> = ({
  context,
  id,
  innerProps: {
    offer
  },
}) => {
  
  const { t } = useTranslation('modals', { keyPrefix: 'sell' });
  const { account } = useWeb3React();

  const { getInputProps, onSubmit, values, isValid } =
    useForm<SellFormValues>({
      // eslint-disable-next-line object-shorthand
      initialValues: {
        offerTokenAddress: offer?.offerTokenAddress ?? '',
        buyerTokenAddress: offer?.buyerTokenAddress ?? '',
        price: offer?.price ?? undefined,
        amount: offer?.amount ?? undefined,
        buyerAddress: offer?.buyerAddress ?? ZERO_ADDRESS,
        isPrivateOffer: offer?.isPrivateOffer ?? false,
      },
      validate: {
        buyerAddress: (value) => (value == account ? t('invalidPrivateOfferAddress'): null),
      },
    });

  // const [isPrivateOffer, setIsPrivateOffer] = useState(false);
  const [isSubmitting, setSubmitting] = useState<boolean>(false);
  const activeChain = useActiveChain();

  const dispatch = useAppDispatch();

  const realTokenYamUpgradeable = useContract(ContractsID.realTokenYamUpgradeable);

  const offers = useAppSelector(selectCreateOffers);

  const saveCreatedOffer = (formValues: SellFormValues) => {
    try{

      const createdOffer: CreatedOffer = {
        offerType: offer.offerType,
        offerId: offers.length,
        offerTokenAddress: formValues.offerTokenAddress,
        buyerTokenAddress: formValues.buyerTokenAddress,
        price: formValues.price ?? 0,
        amount: formValues.amount,
        buyerAddress: formValues.buyerAddress,
        isPrivateOffer: formValues.isPrivateOffer
      }

      dispatch({ type: createOfferAddedDispatchType, payload: createdOffer });

      context.closeModal(id)

    }catch(err){
      console.log(err)
    }
  }

  // const onHandleSubmit = useCallback(
  //   async (formValues: SellFormValues) => {
  //     try {
  //       if (
  //         !account ||
  //         !provider ||
  //         !realTokenYamUpgradeable ||
  //         !formValues.offerTokenAddress ||
  //         !formValues.buyerTokenAddress ||
  //         !formValues.price ||
  //         !formValues.amount
  //       ) {
  //         return;
  //       }

  //       if (!provider || !account) {
  //         return;
  //       }

  //       setSubmitting(true);
  //       const offerToken = getContract<CoinBridgeToken>(
  //         formValues.offerTokenAddress,
  //         coinBridgeTokenABI,
  //         provider,
  //         account
  //       );
  //       const buyerToken = getContract<Erc20>(
  //         formValues.buyerTokenAddress,
  //         Erc20ABI,
  //         provider,
  //         account
  //       );

  //       if (!offerToken || !buyerToken) {
  //         console.log('offerToken or buyerToken not found');
  //         return;
  //       }
  //       const offerTokenDecimals = await offerToken.decimals();
  //       const buyerTokenDecimals = await buyerToken.decimals();

  //       const amountInWei = new BigNumber(
  //         formValues.amount.toString()
  //       ).shiftedBy(Number(offerTokenDecimals));
  //       const oldAllowance = await offerToken.allowance(
  //         account,
  //         realTokenYamUpgradeable.address
  //       );
  //       const amountInWeiToPermit = amountInWei.plus(
  //         new BigNumber(oldAllowance.toString())
  //       );

  //       const priceInWei = new BigNumber(formValues.price.toString()).shiftedBy(
  //         Number(buyerTokenDecimals)
  //       );

  //       const transactionDeadline = Math.floor(Date.now() / 1000) + 3600; // permit valable during 1h

  //       const offerTokenType = await realTokenYamUpgradeable.getTokenType(
  //         formValues.offerTokenAddress
  //       );

  //       if (offerTokenType === 1) {
  //         // TokenType = 1: RealToken
  //         const { r, s, v }: any = await coinBridgeTokenPermitSignature(
  //           account,
  //           realTokenYamUpgradeable.address,
  //           amountInWeiToPermit.toString(),
  //           transactionDeadline,
  //           offerToken,
  //           provider
  //         );

  //         const createOfferWithPermitTx =
  //           await realTokenYamUpgradeable.createOfferWithPermit(
  //             formValues.offerTokenAddress,
  //             formValues.buyerTokenAddress,
  //             formValues.isPrivateOffer === false
  //               ? ZERO_ADDRESS
  //               : formValues.buyerAddress,
  //             priceInWei.toString(),
  //             amountInWei.toString(),
  //             amountInWeiToPermit.toString(10),
  //             transactionDeadline.toString(),
  //             v,
  //             r,
  //             s
  //           );
  //         const notificationPayload = {
  //           key: createOfferWithPermitTx.hash,
  //           href: `${activeChain?.blockExplorerUrl}tx/${createOfferWithPermitTx.hash}`,
  //           hash: createOfferWithPermitTx.hash,
  //         };

  //         showNotification(
  //           NOTIFICATIONS[NotificationsID.createOfferLoading](
  //             notificationPayload
  //           )
  //         );

  //         createOfferWithPermitTx
  //           .wait()
  //           .then(({ status }) =>
  //             updateNotification(
  //               NOTIFICATIONS[
  //                 status === 1
  //                   ? NotificationsID.createOfferSuccess
  //                   : NotificationsID.createOfferError
  //               ](notificationPayload)
  //             )
  //           );
  //       } else if (offerTokenType === 2) {
  //         // TokenType = 2: ERC20 With Permit
  //         const { r, s, v }: any = await erc20PermitSignature(
  //           account,
  //           realTokenYamUpgradeable.address,
  //           amountInWeiToPermit.toString(),
  //           transactionDeadline,
  //           offerToken,
  //           provider
  //         );

  //         const createOfferWithPermitTx =
  //           await realTokenYamUpgradeable.createOfferWithPermit(
  //             formValues.offerTokenAddress,
  //             formValues.buyerTokenAddress,
  //             formValues.isPrivateOffer === false
  //               ? ZERO_ADDRESS
  //               : formValues.buyerAddress,
  //             priceInWei.toString(),
  //             amountInWei.toString(),
  //             amountInWeiToPermit.toString(10),
  //             transactionDeadline.toString(),
  //             v,
  //             r,
  //             s
  //           );
  //         const notificationPayload = {
  //           key: createOfferWithPermitTx.hash,
  //           href: `${activeChain?.blockExplorerUrl}tx/${createOfferWithPermitTx.hash}`,
  //           hash: createOfferWithPermitTx.hash,
  //         };

  //         showNotification(
  //           NOTIFICATIONS[NotificationsID.createOfferLoading](
  //             notificationPayload
  //           )
  //         );

  //         createOfferWithPermitTx
  //           .wait()
  //           .then(({ status }) =>
  //             updateNotification(
  //               NOTIFICATIONS[
  //                 status === 1
  //                   ? NotificationsID.createOfferSuccess
  //                   : NotificationsID.createOfferError
  //               ](notificationPayload)
  //             )
  //           );
  //       } else if (offerTokenType === 3) {
  //         // TokenType = 3: ERC20 Without Permit, do Approve/CreateOffer
  //         const approveTx = await offerToken.approve(
  //           realTokenYamUpgradeable.address,
  //           amountInWeiToPermit.toString()
  //         );

  //         const notificationApprove = {
  //           key: approveTx.hash,
  //           href: `${activeChain?.blockExplorerUrl}tx/${approveTx.hash}`,
  //           hash: approveTx.hash,
  //         };

  //         showNotification(
  //           NOTIFICATIONS[NotificationsID.approveOfferLoading](
  //             notificationApprove
  //           )
  //         );

  //         approveTx
  //           .wait()
  //           .then(({ status }) =>
  //             updateNotification(
  //               NOTIFICATIONS[
  //                 status === 1
  //                   ? NotificationsID.approveOfferSuccess
  //                   : NotificationsID.approveOfferError
  //               ](notificationApprove)
  //             )
  //           );

  //         await approveTx.wait(1);

  //         const createOfferTx = await realTokenYamUpgradeable.createOffer(
  //           formValues.offerTokenAddress,
  //           formValues.buyerTokenAddress,
  //           formValues.isPrivateOffer === false
  //             ? ZERO_ADDRESS
  //             : formValues.buyerAddress,
  //           priceInWei.toString(),
  //           amountInWei.toString()
  //         );

  //         const notificationCreateOffer = {
  //           key: createOfferTx.hash,
  //           href: `${activeChain?.blockExplorerUrl}tx/${createOfferTx.hash}`,
  //           hash: createOfferTx.hash,
  //         };

  //         showNotification(
  //           NOTIFICATIONS[NotificationsID.createOfferLoading](
  //             notificationCreateOffer
  //           )
  //         );

  //         createOfferTx
  //           .wait()
  //           .then(({ status }) =>
  //             updateNotification(
  //               NOTIFICATIONS[
  //                 status === 1
  //                   ? NotificationsID.createOfferSuccess
  //                   : NotificationsID.createOfferError
  //               ](notificationCreateOffer)
  //             )
  //           );
  //       } else {
  //         console.log('Token is not whitelisted');
  //         showNotification(NOTIFICATIONS[NotificationsID.createOfferInvalid]());
  //       }
  //     } catch (error) {
  //       console.log('ERROR WHEN SELLING WITH PERMIT', error);
  //       showNotification(NOTIFICATIONS[NotificationsID.createOfferInvalid]());
  //     } finally {
  //       setSubmitting(false);
  //     }
  //   },
  //   [account, provider, realTokenYamUpgradeable, activeChain?.blockExplorerUrl]
  // );

  const privateOffer = () => {
    if (getInputProps('isPrivateOffer', { type: 'checkbox' }).checked) {
      return(
        <TextInput
          label={t('labelPrivateBuyerAddress')}
          placeholder={t('placeholderOfferPrivatBuyerAddress')}
          required={values.isPrivateOffer}
          disabled={!values.isPrivateOffer}
          error={"Impossible de créér une offre à destination de votre address"}
          {...getInputProps('buyerAddress')}
        />
      )
    } else {
      return
    }
  }

  const { buyerTokens, offerTokens } = useCreateOfferTokens(offer.offerType, values.offerTokenAddress, values.buyerTokenAddress);

  const offerTokenSymbol = offerTokens.find(value => value.value == values.offerTokenAddress)?.label;
  const buyTokenSymbol =  buyerTokens.find(value => value.value == values.buyerTokenAddress)?.label;
  const total = (values.amount ?? 0) * (values.price ?? 0);

  const summary = () => {
    if(total && buyTokenSymbol && offerTokenSymbol){
      return (
        <Text size={"md"} mb={10}>
            {` ${t("summaryText1")} ${values?.amount} "${offerTokenSymbol}" ${t("summaryText2")} ${cleanNumber(values.price ?? 0)} ${buyTokenSymbol} ${t("summaryText3")} ${total} ${buyTokenSymbol}`}
        </Text>
      )
    }else{
      return undefined;
    }
  }

  const SelectItem = forwardRef<HTMLDivElement, ItemProps>(
    ({ label, value, ...others }: ItemProps, ref) => (
      <Flex ref={ref} {...others} key={label} gap={"sx"} direction={"column"}>
          <Text fz={"sm"} fw={700}>{label}</Text>
          <Text fz={"xs"} fs={"italic"}>{value}</Text>
      </Flex>
    )
  );

  return (
    <Flex direction={"column"} sx={{ maxWidth: 400 }} mx={'auto'} gap={"md"}>
      <Flex gap={"sm"}>
        <OfferTypeBadge offerType={offer.offerType} />
        <h3 style={{ margin: 0 }}>{t('titleFormCreateOffer')}</h3>
      </Flex>
      <form onSubmit={onSubmit(saveCreatedOffer)}>
        <Stack justify={'center'} align={'stretch'}>
          <Select
            label={t('offerTokenAddress')}
            placeholder={t('placeholderOfferSellTokenAddress')}
            searchable={true}
            required={true}
            nothingFound={"No property found"}
            itemComponent={SelectItem}
            data={offerTokens}
            {...getInputProps('offerTokenAddress')}
          />
          <Select
            label={t('buyerTokenAddress')}
            placeholder={t('placeholderOfferBuyTokenAddress')}
            searchable={true}
            nothingFound={"No property found"}
            itemComponent={SelectItem}
            data={buyerTokens}
            required={true}
            {...getInputProps('buyerTokenAddress')}
          />
          <NumberInput
            label={t('price')}
            placeholder={t('placeholderPrice')}
            required={true}
            min={0.000001}
            max={undefined}
            step={undefined}
            showMax={false}
            sx={{ flexGrow: 1 }}
            {...getInputProps('price')}
          />
          <NumberInput
            label={t('amount')}
            placeholder={t('placeholderAmount')}
            required={true}
            min={0.000001}
            max={undefined}
            step={undefined}
            showMax={false}
            sx={{ flexGrow: 1 }}
            {...getInputProps('amount')}
          />
          
          <Checkbox
            mt={'md'}
            label={t('checkboxLabelPrivateOffre')}
            {...getInputProps('isPrivateOffer', { type: 'checkbox' })}
          />

          {privateOffer()}

          <Group position={'left'} mt={'md'}>
            <>
              {summary()}
              <Button
                type={'submit'}
                loading={isSubmitting}
                aria-label={'submit'}
                disabled={!isValid}
              >
                { offer ? t('buttonModifyCreateOffer') : t('buttonCreateOffer')}
              </Button>
            </>
          </Group>
        </Stack>
      </form>
    </Flex>
  );
};
