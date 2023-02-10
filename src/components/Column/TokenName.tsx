import { Flex, Skeleton, Text } from "@mantine/core";
import { usePropertyToken } from "src/hooks/usePropertyToken";
import { Offer, OFFER_TYPE } from "src/types/offer"
import { TextUrl } from "../TextUrl/TextUrl";

interface TokenNameProps{
    offer: Offer,
    tokenName?: string
}
export const TokenName = ({ offer, tokenName } : TokenNameProps) => {

    const tokenAddress = offer.type == OFFER_TYPE.SELL ? offer.buyerTokenAddress : offer.offerTokenAddress;
    const { propertyToken } = usePropertyToken(tokenAddress);

    return(
        <Flex justify={"start"}>
        {   propertyToken ? 
                <TextUrl url={propertyToken.marketplaceLink}>{propertyToken.shortName}</TextUrl>
            : !tokenAddress ?
                <Skeleton height={15} />
            :
                <Text>{tokenName}</Text>
        }
        </Flex>
    )
}