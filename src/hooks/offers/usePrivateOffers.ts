import { useQuery } from "react-query";
import { useWeb3React } from "@web3-react/core";
import { Offer, OFFER_LOADING } from "../../types/offer";
import { REACT_QUERY_ERRORS } from "../../types/ReactQueryErrors";
import { fetchPrivateOffersRpc } from "../../utils/rpc/fetchPrivateOffersRpc";
import { usePrices } from "../interface/usePrices";
import { useProperties } from "../interface/useProperties";
import { useWlProperties } from "../interface/useWlProperties";

type UsePrivateOffers = () => {
    offers: Offer[];
    offersAreLoading: boolean;
    refetch: () => void;
}
export const usePrivateOffers: UsePrivateOffers = () => {
    const { chainId, account } = useWeb3React();
    const { properties, propertiesAreLoading } = useProperties();
    const { prices, pricesAreLoading } = usePrices();
    const { wlProperties, wlPropertiesAreLoading } = useWlProperties();

    const {
        isLoading: loading,
        data: offers,
        isSuccess,
        refetch,
    } = useQuery({
        queryKey: ['privateOffers', chainId, account],
        meta: { errCode: REACT_QUERY_ERRORS.FETCH_OFFERS },
        enabled: !!chainId && !!account && !!properties && !!prices && !!wlProperties,
        queryFn: async (): Promise<Offer[]> => {
            if (!chainId || !account || !properties || !prices || !wlProperties)
                return OFFER_LOADING;

            try {
                // Use RPC to fetch only private offers where user is the buyer
                const privateOffers = await fetchPrivateOffersRpc(
                    account,
                    chainId,
                    properties,
                    wlProperties,
                    prices
                );

                return privateOffers;
            } catch (error: any) {
                console.error('Error fetching private offers:', error);
                // Return empty array instead of OFFER_LOADING to allow page to render
                return [];
            }
        },
    });

    const offersAreLoading = loading || propertiesAreLoading || pricesAreLoading || wlPropertiesAreLoading;

    return { 
        offers: isSuccess ? offers : [], 
        offersAreLoading, 
        refetch 
    };
}