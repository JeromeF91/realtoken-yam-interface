import { Flex, Skeleton, Text } from "@mantine/core"
import BigNumber from "bignumber.js";
import { useMemo } from "react";
import { useOfferPriceInDollar } from "src/hooks/useOfferPriceInDollar";
import { useOraclePriceFeed } from "src/hooks/useOraclePriceFeed";
import { usePropertyToken } from "src/hooks/usePropertyToken";
import { Offer, OFFER_TYPE } from "src/types/offer";
import { getPropertyTokenAddress } from "src/utils/properties";

interface OfferYieldProps{
    offer: Offer
}
export const OfferYield = ({ offer } : OfferYieldProps) => {

    // const { propertyToken } = usePropertyToken(getPropertyTokenAddress(offer));
    // const { price } = useOraclePriceFeed(offer.type == OFFER_TYPE.BUY ? offer.offerTokenAddress: offer.buyerTokenAddress);

    // const { tokenPriceInDollar } = useOfferPriceInDollar(price,offer);

    // const offerAjustedYield: BigNumber|undefined = useMemo(() => {
    //     if(!propertyToken || !propertyToken.netRentYearPerToken || !tokenPriceInDollar) return undefined;
    //     const offerAdjusted = new BigNumber(propertyToken.netRentYearPerToken).dividedBy(tokenPriceInDollar);
    //     return offerAdjusted;
    // },[propertyToken, tokenPriceInDollar]);

    // const offerDelta: BigNumber|undefined = useMemo(() => {
    //     if(!offerAjustedYield || !propertyToken) return undefined;
    //     const originalYield = propertyToken.annualYield;
    //     return originalYield ? offerAjustedYield.multipliedBy(new BigNumber(1)).dividedBy(new BigNumber(originalYield)).minus(1) : undefined;
    // },[offerAjustedYield, propertyToken]);

    // const isZero: boolean|undefined = useMemo(() => {
    //     if(!offerDelta) return undefined;
    //     const valueFloat = (parseFloat(offerDelta.toString())*100).toFixed(0);
    //     return valueFloat == "0" || valueFloat == "-0"
    // },[offerDelta])

    // console.log(offerAjustedYield?.toString(), offerDelta?.toString(), isZero !== undefined);
    // console.log(offerAjustedYield && offerDelta && isZero !== undefined)

    return(
        <Flex gap={"sm"} justify={"center"}>
            { offer.offerYield ?
                <Text>{`${offer.offerYield.toFixed(2)}%`}</Text>
                :
                <Skeleton height={15}/>
            }
        </Flex>
    )
}