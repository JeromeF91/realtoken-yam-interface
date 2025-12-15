import { useQuery } from "react-query";
import { useWeb3React } from "@web3-react/core";
import { Offer, OFFER_LOADING } from "../../types/offer";
import { REACT_QUERY_ERRORS } from "../../types/ReactQueryErrors";
import { fetchPublicOffersRpc } from "../../utils/rpc/fetchPublicOffersRpc";
import { usePrices } from "../interface/usePrices";
import { useProperties } from "../interface/useProperties";
import { useWlProperties } from "../interface/useWlProperties";

type UsePublicOffers = () => {
    offers: Offer[];
    offersAreLoading: boolean;
    refetch: () => void;
}
export const usePublicOffers: UsePublicOffers = () => {
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
        queryKey: ['publicOffers', chainId, account],
        meta: { errCode: REACT_QUERY_ERRORS.FETCH_OFFERS },
        enabled: !!chainId && !!account && !!properties && !!prices && !!wlProperties,
        queryFn: async (): Promise<Offer[]> => {
            if (!chainId || !account || !properties || !prices || !wlProperties)
                return OFFER_LOADING;

            try {
                // Use RPC to fetch only the last 10 public offers
                const publicOffers = await fetchPublicOffersRpc(
                    account,
                    chainId,
                    properties,
                    wlProperties,
                    prices
                );

                return publicOffers;
            } catch (error: any) {
                console.error('Error fetching public offers:', error);
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