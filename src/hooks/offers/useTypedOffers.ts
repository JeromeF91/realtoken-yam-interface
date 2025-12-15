import { useAtomValue } from "jotai"
import { useMemo } from "react"
import { tableOfferTypeAtom } from "src/states"
import { Offer, OFFER_LOADING, OFFER_TYPE } from "src/types/offer"

const getTypedOffers = (type: OFFER_TYPE, offers: Offer[], offersLoading: boolean): Offer[] => {
    if (!offers || offersLoading) return OFFER_LOADING;
    // Use strict equality and handle both string and enum comparisons
    const filtered = offers.filter((offer: Offer) => {
        const offerType = offer.type;
        const matches = offerType === type || offerType === type.toString();
        if (!matches && offerType) {
            // Debug: log mismatches for EXCHANGE type
            if (type === OFFER_TYPE.EXCHANGE) {
                console.log('EXCHANGE filter - offer type mismatch:', {
                    offerId: offer.offerId,
                    offerType,
                    expectedType: type,
                    offerTypeString: typeof offerType,
                    expectedTypeString: typeof type,
                });
            }
        }
        return matches;
    });
    return filtered;
}

type UseTypedOffers = (offers: Offer[], offersAreLoading?: boolean) => {
    offers: Offer[];
    sellCount: number|undefined;
    buyCount: number|undefined;
    exchangeCount: number|undefined;
}

export const useTypedOffers: UseTypedOffers = (
    offers,
    offersAreLoading = false
)  => {

    const tableOfferType = useAtomValue(tableOfferTypeAtom);
    
    return useMemo(() => ({
        offers: [...getTypedOffers(tableOfferType, offers, offersAreLoading)],
        sellCount: !offersAreLoading ? getTypedOffers(OFFER_TYPE.SELL, offers, offersAreLoading).length : undefined,
        buyCount: !offersAreLoading ? getTypedOffers(OFFER_TYPE.BUY, offers, offersAreLoading).length : undefined,
        exchangeCount: !offersAreLoading ? getTypedOffers(OFFER_TYPE.EXCHANGE, offers, offersAreLoading).length : undefined,
    }),[offersAreLoading, tableOfferType, offers])
}