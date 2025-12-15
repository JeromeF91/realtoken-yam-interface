import { useEffect, useMemo, useState } from "react";
import { Offer } from "../types/offer";
import BigNumber from "bignumber.js";
import { getContract } from "@realtoken/realt-commons";
import { CoinBridgeToken, coinBridgeTokenABI } from "../abis";
import { useContract } from "./useContract";
import { ContractsID, NOTIFICATIONS, NotificationsID } from "../constants";
import { useWeb3React } from '@web3-react/core';
import { Web3Provider } from "@ethersproject/providers";
import { useActiveChain } from "./useActiveChain";
import { showNotification, updateNotification } from "@mantine/notifications";

type UseOffersComputedDatas = (
    offer: Offer,
    amount: number
) => {
    amountInWei: BigNumber;
    buyerTokenAmount: BigNumber;
    priceInWei: BigNumber;
}
export const useOffersComputedDatas: UseOffersComputedDatas = (offer, amount) => {

    const price = parseFloat(offer.price);
    // Note: offerToken and buyerToken are reversed in naming
    // When buying: you're buying buyerToken (what seller offers), paying with offerToken (what you pay)
    // So priceInWei should use offerTokenDecimals (what you pay with)
    const priceInWei = new BigNumber(price.toString()).shiftedBy(Number(offer.offerTokenDecimals));

    // amountInWei is how much buyerToken you're buying (what seller offers)
    const amountInWei = new BigNumber(parseInt(new BigNumber(amount.toString()).shiftedBy(Number(offer.buyerTokenDecimals)).toString()));
    // buyerTokenAmount is how much offerToken you need to pay (what you pay with)
    const buyerTokenAmount = new BigNumber(parseInt(amountInWei.multipliedBy(priceInWei).shiftedBy(-offer.buyerTokenDecimals).toString()));

    return{
        amountInWei,
        buyerTokenAmount,
        priceInWei
    }
}

type UseApproveOffer = (
    offer: Offer,
    amountToCheck: number
) => {
    approveNeeded: boolean;
    approve: () => Promise<void>;
    approveLoading: boolean;
}
export const useApproveOffer: UseApproveOffer = (offer, amount) => {

    const [approveNeeded, setApproveNeeded] = useState<boolean>(false);
    const [approveLoading, setApproveLoading] = useState<boolean>(false);

    const { buyerTokenAmount } = useOffersComputedDatas(offer, amount);
    const { account, provider } = useWeb3React();
    const activeChain = useActiveChain();

    const realTokenYamUpgradeable = useContract(ContractsID.realTokenYamUpgradeable);

    // When buying, you pay with offerToken (not buyerToken)
    // The offerToken and buyerToken are reversed in the naming
    // So we need to approve offerToken, not buyerToken
    const tokenToApproveAddress = offer.offerTokenAddress;

    const buyerToken = useMemo(() => getContract<CoinBridgeToken>(
        tokenToApproveAddress,
        coinBridgeTokenABI,
        provider as Web3Provider,
        account
    ),[tokenToApproveAddress, account, provider]);

    const checkApproval = async () => {
        if(!buyerToken || !realTokenYamUpgradeable || !account || buyerTokenAmount.isNaN()) return;
        try{
            // Use callStatic for read-only call
            const allowance = await buyerToken.callStatic.allowance(account, realTokenYamUpgradeable.address);
            setApproveNeeded(allowance.lt(buyerTokenAmount.toString(10)));
        }catch(err: any){
            console.error('Cannot check approval: ', err);
            // If allowance() is not supported, assume approval is needed
            // This allows the user to proceed with the transaction
            // The actual buy transaction will handle the approval check
            if (err?.code === 'CALL_EXCEPTION' || err?.message?.includes('revert')) {
                console.warn('Token does not support allowance() function, assuming approval needed');
                setApproveNeeded(true);
            }
        }
    }

    const approve = async () => {
        if(!buyerToken || !realTokenYamUpgradeable || !account) {
            return;
        }
        
        try{
            setApproveLoading(true);

            const approveTx = await buyerToken.approve(
                realTokenYamUpgradeable.address,
                buyerTokenAmount.toString(10)
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
                .then(({ status }) => {
                    updateNotification(
                    NOTIFICATIONS[
                        status === 1
                        ? NotificationsID.approveOfferSuccess
                        : NotificationsID.approveOfferError
                    ](notificationApprove)
                    );
                })
                .catch((waitError) => {
                    console.error('Error waiting for approval transaction:', waitError);
                    setApproveLoading(false);
                });

            approveTx.wait(1)
                .then(({ status }) => {
                    if(status == 1){
                        setApproveNeeded(false);
                        setApproveLoading(false);
                        // Re-check allowance after approval
                        checkApproval();
                    } else {
                        setApproveLoading(false);
                    }
                })
                .catch((waitError) => {
                    console.error('Error waiting for approval transaction finalization:', waitError);
                    setApproveLoading(false);
                });

        }catch(err: any){
             console.error('Cannot approve: ', err);
             setApproveLoading(false);
             
             // Show error notification
             showNotification(
                 NOTIFICATIONS[NotificationsID.approveOfferError]({
                     key: 'approval-error',
                     hash: '',
                     href: '',
                 })
             );
        }
    }

    useEffect(() => {
        if (offer && amount && buyerToken && realTokenYamUpgradeable && account) {
            checkApproval();
        }
    },[offer, amount, buyerToken, realTokenYamUpgradeable, account, buyerTokenAmount]);

    return{
        approveNeeded: approveNeeded,
        approve,
        approveLoading
    }
}