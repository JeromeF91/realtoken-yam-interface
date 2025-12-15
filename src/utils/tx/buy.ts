import { showNotification, updateNotification } from "@mantine/notifications";
import BigNumber from "bignumber.js";
import { Chain, ContractsID, NOTIFICATIONS, NotificationsID, TypedContract } from 'src/constants';
import coinBridgeTokenPermitSignature from "../../hooks/coinBridgeTokenPermitSignature";
import erc20PermitSignature from "../../hooks/erc20PermitSignature";
import { Web3Provider } from "@ethersproject/providers";
import { CoinBridgeToken, coinBridgeTokenABI } from "../../abis";
import { Offer } from "../../types/offer";
import { getContract } from "../getContract";
import { AvailableConnectors, ConnectorsDatas } from "@realtoken/realt-commons";

export enum BUY_METHODS{
  buyWithApprove = "buyWithApprove",
  buyWithPermit = "buyWithPermit"
}

export const approve = async (

) => {
  try{

    

  }catch(err){
    console.error(err);
  }
}

export const buy = async (
    account: string|undefined,
    provider: Web3Provider|undefined,
    activeChain: Chain|undefined,
    realTokenYamUpgradeable: TypedContract<ContractsID>|undefined,
    offer: Offer,
    amount: number,
    connector: string,
    setSubmitting: (state: boolean) => void,
    onFinished?: () => void,
    method?: string
) => {
      try {
        if (
          !account ||
          !provider ||
          !amount ||
          !realTokenYamUpgradeable
        ){
          return;
        }

        const buyMethod = method ?? BUY_METHODS.buyWithApprove;
        // console.log("buyMethod: ", buyMethod)

        const price = parseFloat(offer.price);

        // Note: offerToken and buyerToken are reversed in naming
        // When buying: you're buying buyerToken (what seller offers), paying with offerToken (what you pay)
        // amountInWei is how much buyerToken you're buying (what seller offers)
        const amountInWei = new BigNumber(parseInt(new BigNumber(amount.toString()).shiftedBy(Number(offer.buyerTokenDecimals)).toString()));
        // priceInWei is the price in offerToken (what you pay with)
        const priceInWei = new BigNumber(price.toString()).shiftedBy(Number(offer.offerTokenDecimals));

        // console.log("amountInWei: ", amountInWei.toString())
        // console.log("priceInWei: ", priceInWei.toString())

        // When buying, you pay with offerToken, so we need to approve offerToken
        const paymentToken = getContract<CoinBridgeToken>(
            offer.offerTokenAddress,
            coinBridgeTokenABI,
            provider as Web3Provider,
            account
        );

        if(!paymentToken){
          console.error("paymentToken (offerToken) is undefined");
          return;
        };

        // paymentTokenAmount is how much offerToken you need to pay (what you pay with)
        const paymentTokenAmount = new BigNumber(parseInt(amountInWei.multipliedBy(priceInWei).shiftedBy(-offer.buyerTokenDecimals).toString()));
        const transactionDeadline = Math.floor(Date.now() / 1000) + 3600; // permit valable during 1h

        console.log("paymentTokenAmount (offerToken): ", paymentTokenAmount.toString())

        let approveNeeded = false;
        if(buyMethod == BUY_METHODS.buyWithApprove){
          try {
            // Use callStatic for read-only call and handle errors gracefully
            const allowance = await paymentToken.callStatic.allowance(account, realTokenYamUpgradeable.address);
            console.log("allowance: ", allowance.toString());
            if(allowance.lt(paymentTokenAmount.toString(10))){
              approveNeeded = true;
            }
          } catch (err: any) {
            console.error('Error checking allowance in buy.ts:', err);
            // If allowance call reverts, assume approval is needed
            if (err?.code === 'CALL_EXCEPTION' || err?.message?.includes('revert')) {
              console.warn('Token does not support allowance() function, assuming approval needed');
              approveNeeded = true;
            } else {
              // For other errors, re-throw
              throw err;
            }
          }
        }

        console.log("approveNeeded: ", approveNeeded)

        // When buying, we need to check the token type of the payment token (offerToken)
        const paymentTokenType = await realTokenYamUpgradeable.getTokenType(
          offer.offerTokenAddress
        );

        if(
          connector == ConnectorsDatas.get(AvailableConnectors.gnosisSafe)?.connectorKey || 
          connector == ConnectorsDatas.get(AvailableConnectors.walletConnectV2)?.connectorKey || 
          buyMethod == BUY_METHODS.buyWithApprove
        ){

          if(approveNeeded){
            // TokenType = 3: ERC20 Without Permit, do Approve/buy
            const approveTx = await paymentToken.approve(
              realTokenYamUpgradeable.address,
              paymentTokenAmount.toString(10)
            );

            const notificationApprove = {
              key: approveTx.hash,
              href: `${activeChain?.blockExplorerUrl}tx/${approveTx.hash}`,
              hash: approveTx.hash,
            };

            showNotification(
              NOTIFICATIONS[NotificationsID.approveOfferLoading](
                notificationApprove
              )
            );

            approveTx
              .wait()
              .then(({ status }) =>
                updateNotification(
                  NOTIFICATIONS[
                    status === 1
                      ? NotificationsID.approveOfferSuccess
                      : NotificationsID.approveOfferError
                  ](notificationApprove)
                )
              );

            await approveTx.wait(1);
          }

          const buyTx = await realTokenYamUpgradeable.buy(
            offer.offerId,
            priceInWei.toString(),
            amountInWei.toString()
          );

          const notificationBuy = {
            key: buyTx.hash,
            href: `${activeChain?.blockExplorerUrl}tx/${buyTx.hash}`,
            hash: buyTx.hash,
          };

          showNotification(
            NOTIFICATIONS[NotificationsID.buyOfferLoading](notificationBuy)
          );

          buyTx
            .wait()
            .then(({ status }) =>
              updateNotification(
                NOTIFICATIONS[
                  status === 1
                    ? NotificationsID.buyOfferSuccess
                    : NotificationsID.buyOfferError
                ](notificationBuy)
              )
            );
            

        }else{
          if (paymentTokenType === 1) {
            // TokenType = 1: RealToken
  
            const { r, s, v }: any = await coinBridgeTokenPermitSignature(
              account,
              realTokenYamUpgradeable.address,
              paymentTokenAmount.toString(),
              transactionDeadline,
              paymentToken,
              provider
            );
  
            const tx = await realTokenYamUpgradeable.buyWithPermit(
              offer.offerId,
              priceInWei.toString(),
              amountInWei.toString(),
              transactionDeadline.toString(),
              v,
              r,
              s
            );
            
            const notificationPayload = {
              key: tx.hash,
              href: `${activeChain?.blockExplorerUrl}tx/${tx.hash}`,
              hash: tx.hash,
            };
  
            showNotification(
              NOTIFICATIONS[NotificationsID.buyOfferLoading](notificationPayload)
            );
  
            tx
              .wait()
              .then(({ status }) =>
                updateNotification(
                  NOTIFICATIONS[
                    status === 1
                      ? NotificationsID.buyOfferSuccess
                      : NotificationsID.buyOfferError
                  ](notificationPayload)
                )
              );
          } else if (paymentTokenType === 2) {
            // TokenType = 2: ERC20 With Permit
            const { r, s, v }: any = await erc20PermitSignature(
              account,
              realTokenYamUpgradeable.address,
              paymentTokenAmount.toString(),
              transactionDeadline,
              paymentToken,
              provider
            );
  
            const buyWithPermitTx = await realTokenYamUpgradeable.buyWithPermit(
              offer.offerId,
              priceInWei.toString(),
              amountInWei.toString(),
              transactionDeadline.toString(),
              v,
              r,
              s
            );
  
            const notificationPayload = {
              key: buyWithPermitTx.hash,
              href: `${activeChain?.blockExplorerUrl}tx/${buyWithPermitTx.hash}`,
              hash: buyWithPermitTx.hash,
            };
  
            showNotification(
              NOTIFICATIONS[NotificationsID.buyOfferLoading](notificationPayload)
            );
  
            buyWithPermitTx
              .wait()
              .then(({ status }) =>
                updateNotification(
                  NOTIFICATIONS[
                    status === 1
                      ? NotificationsID.buyOfferSuccess
                      : NotificationsID.buyOfferError
                  ](notificationPayload)
                )
              );
          } else if (paymentTokenType === 3) {

            // TokenType = 3: ERC20 Without Permit, do Approve/buy

          
            if(approveNeeded){


              const approveTx = await paymentToken.approve(
                realTokenYamUpgradeable.address,
                paymentTokenAmount.toString()
              );
    
              const notificationApprove = {
                key: approveTx.hash,
                href: `${activeChain?.blockExplorerUrl}tx/${approveTx.hash}`,
                hash: approveTx.hash,
              };
    
              showNotification(
                NOTIFICATIONS[NotificationsID.approveOfferLoading](
                  notificationApprove
                )
              );
    
              approveTx
                .wait()
                .then(({ status }) =>
                  updateNotification(
                    NOTIFICATIONS[
                      status === 1
                        ? NotificationsID.approveOfferSuccess
                        : NotificationsID.approveOfferError
                    ](notificationApprove)
                  )
                );
    
              await approveTx.wait(1);

            }
  
            const buyTx = await realTokenYamUpgradeable.buy(
              offer.offerId,
              priceInWei.toString(),
              amountInWei.toString()
            );
  
            const notificationBuy = {
              key: buyTx.hash,
              href: `${activeChain?.blockExplorerUrl}tx/${buyTx.hash}`,
              hash: buyTx.hash,
            };
  
            showNotification(
              NOTIFICATIONS[NotificationsID.buyOfferLoading](notificationBuy)
            );
  
            buyTx
              .wait()
              .then(({ status }) =>
                updateNotification(
                  NOTIFICATIONS[
                    status === 1
                      ? NotificationsID.buyOfferSuccess
                      : NotificationsID.buyOfferError
                  ](notificationBuy)
                )
              );
          } else {
            console.log('Token is not whitelisted');
            showNotification(NOTIFICATIONS[NotificationsID.buyOfferInvalid]());
          }
        }

        if(onFinished) onFinished();

      } catch (e) {
        console.error('Error in BuyModalWithPermit', e);
        showNotification(NOTIFICATIONS[NotificationsID.buyOfferInvalid]());
        setSubmitting(false);
      }
}