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
    const priceInWei = new BigNumber(price.toString()).shiftedBy(Number(offer.buyerTokenDecimals));

    const amountInWei = new BigNumber(parseInt(new BigNumber(amount.toString()).shiftedBy(Number(offer.offerTokenDecimals)).toString()));
    const buyerTokenAmount = new BigNumber(parseInt(amountInWei.multipliedBy(priceInWei).shiftedBy(-offer.offerTokenDecimals).toString()));

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

    // Determine which token needs approval: when buying, you pay with buyerToken
    // However, we need to check if buyerToken is actually a payment token (USDC, etc.)
    // or if it's a property token. If buyerToken is a property token, we should check offerToken instead.
    // USDC on Gnosis: 0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83
    // USDC on Ethereum: 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
    const USDC_GNOSIS = '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83';
    const USDC_ETHEREUM = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    
    // Check if buyerToken is USDC (payment token) or if offerToken is USDC
    const isBuyerTokenUSDC = offer.buyerTokenAddress.toLowerCase() === USDC_GNOSIS.toLowerCase() ||
                              offer.buyerTokenAddress.toLowerCase() === USDC_ETHEREUM.toLowerCase() ||
                              offer.buyerTokenName?.toUpperCase().includes('USDC') ||
                              offer.buyerTokenSymbol?.toUpperCase().includes('USDC');
    
    const isOfferTokenUSDC = offer.offerTokenAddress.toLowerCase() === USDC_GNOSIS.toLowerCase() ||
                             offer.offerTokenAddress.toLowerCase() === USDC_ETHEREUM.toLowerCase() ||
                             offer.offerTokenName?.toUpperCase().includes('USDC') ||
                             offer.offerTokenSymbol?.toUpperCase().includes('USDC');
    
    // When buying, you need to approve the token you're paying with
    // If offerToken is USDC, you're paying with USDC (offerToken)
    // If buyerToken is USDC, you're paying with USDC (buyerToken)
    // Otherwise, default to buyerToken (you pay with buyerToken)
    let tokenToApproveAddress = offer.buyerTokenAddress;
    
    if (isOfferTokenUSDC) {
      // If offerToken is USDC, you're paying with USDC (offerToken)
      tokenToApproveAddress = offer.offerTokenAddress;
      console.log("useApproveOffer: Using offerToken (USDC) for approval:", tokenToApproveAddress);
    } else if (isBuyerTokenUSDC) {
      // If buyerToken is USDC, you're paying with USDC (buyerToken)
      tokenToApproveAddress = offer.buyerTokenAddress;
      console.log("useApproveOffer: Using buyerToken (USDC) for approval:", tokenToApproveAddress);
    } else {
      // Default: you pay with buyerToken
      tokenToApproveAddress = offer.buyerTokenAddress;
      console.log("useApproveOffer: Using buyerToken (default) for approval:", tokenToApproveAddress);
    }
    
    console.log("useApproveOffer: Token addresses:", {
        offerId: offer.offerId,
        buyerTokenAddress: offer.buyerTokenAddress,
        offerTokenAddress: offer.offerTokenAddress,
        tokenToApproveAddress: tokenToApproveAddress,
        buyerTokenName: offer.buyerTokenName,
        offerTokenName: offer.offerTokenName,
        buyerTokenSymbol: offer.buyerTokenSymbol,
        offerTokenSymbol: offer.offerTokenSymbol,
        isBuyerTokenUSDC,
        isOfferTokenUSDC,
    });

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
            console.log("ALLOWANCE check:", {
                tokenAddress: tokenToApproveAddress,
                allowance: allowance.toString(),
                buyerTokenAmount: buyerTokenAmount.toString(10),
                realTokenYamAddress: realTokenYamUpgradeable.address,
            });

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
        if(!buyerToken || !realTokenYamUpgradeable) return;
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
                .then(({ status }) =>
                    updateNotification(
                    NOTIFICATIONS[
                        status === 1
                        ? NotificationsID.approveOfferSuccess
                        : NotificationsID.approveOfferError
                    ](notificationApprove)
                    )
                );

            approveTx.wait(1)
                .then(({ status }) => {
                    if(status == 1){
                        setApproveNeeded(false);
                        setApproveLoading(false)
                    }
                });

        }catch(err){
             console.error('Cannot approve: ', err);
             setApproveLoading(false);
        }
    }

    useEffect(() => {
        checkApproval();
    },[offer, amount]);

    return{
        approveNeeded: approveNeeded,
        approve,
        approveLoading
    }
}