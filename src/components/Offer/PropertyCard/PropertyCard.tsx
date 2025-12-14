import { Flex, Skeleton, Text, useMantineTheme } from "@mantine/core"
import { IconExternalLink } from "@tabler/icons"
import { PropertiesToken } from "src/types"
import { Offer } from "src/types/offer"
import { openInNewTab } from "src/utils/window"
import { OfferDeltaTable } from "../../Table/OfferDeltaTable/OfferDeltaTable"
import { PropertyImage } from "../Image/PropertyImage"
import classes from './PropertyCard.module.css';

interface PropertyCardProps{
    propertyToken: PropertiesToken,
    offer: Offer
}
export const PropertyCard = ({ propertyToken, offer }: PropertyCardProps) => {

    const { colors } = useMantineTheme();

    return(
        <Flex className={classes.container}>
            <Flex className={classes.propertyInfosContainer} direction="column">
                <PropertyImage property={propertyToken}/>
                <Flex direction={"column"} style={{ width: '100%', marginTop: 'var(--mantine-spacing-md)' }}>
                    <div className={classes.propertyNameContainer}>
                    {   propertyToken ?
                            <Flex className={classes.propertyName} gap={5} align={"center"} onClick={() => openInNewTab(propertyToken.marketplaceLink)}>
                                <Text c={"brand"} fw={700} fz={"xl"}>{propertyToken.shortName}</Text>
                                <IconExternalLink size={20} color={colors.brand[9]}/>
                            </Flex>
                        : 
                            <Skeleton height={25} width={200}/> 
                    }
                    </div>
                    <Flex direction={"column"} gap={"md"} style={{ marginTop: 'var(--mantine-spacing-md)' }}>
                        { offer ?
                            (() => {
                                // Calculate offerPrice
                                const calculatedOfferPrice = offer.offerPrice !== undefined 
                                    ? offer.offerPrice 
                                    : (offer.price ? parseFloat(offer.price) : undefined);
                                
                                // Calculate offerYield: (netRentYearPerToken / offerPrice) * 100
                                const calculatedOfferYield = offer.offerYield !== undefined 
                                    ? offer.offerYield 
                                    : (() => {
                                        if (propertyToken.netRentYearPerToken && calculatedOfferPrice) {
                                            if (calculatedOfferPrice > 0) {
                                                const yieldValue = (propertyToken.netRentYearPerToken / calculatedOfferPrice) * 100;
                                                console.log('PropertyCard: Calculating offerYield', {
                                                    netRentYearPerToken: propertyToken.netRentYearPerToken,
                                                    offerPrice: calculatedOfferPrice,
                                                    calculatedYield: yieldValue,
                                                });
                                                return yieldValue;
                                            }
                                        }
                                        return undefined;
                                    })();
                                
                                console.log('PropertyCard: Passing values to OfferDeltaTable', {
                                    offerPrice: calculatedOfferPrice,
                                    offerYield: calculatedOfferYield,
                                    officialPrice: propertyToken.officialPrice,
                                    officialYield: propertyToken.annualYield ? propertyToken.annualYield*100 : undefined,
                                });
                                
                                return (
                                    <OfferDeltaTable 
                                        offer={offer}
                                        offerPrice={calculatedOfferPrice}
                                        offerYield={calculatedOfferYield}
                                        officialPrice={propertyToken.officialPrice}
                                        officialYield={propertyToken.annualYield ? propertyToken.annualYield*100 : undefined}
                                    />
                                );
                            })()
                            :
                            <Skeleton height={15}/>
                        }
                    </Flex>
                </Flex>
            </Flex>
        </Flex>
    )
}