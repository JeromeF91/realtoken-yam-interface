import { useQuery } from "react-query";
import { useWeb3React } from "@web3-react/core";
import { Offer, OFFER_LOADING } from "../../types/offer";
import { REACT_QUERY_ERRORS } from "../../types/ReactQueryErrors";
import { fetchUserOffersRpc } from "../../utils/rpc/fetchUserOffersRpc";
import { usePrices } from "../interface/usePrices";
import { useProperties } from "../interface/useProperties";
import { useWlProperties } from "../interface/useWlProperties";

type UseUserOffers = () => {
    offers: Offer[];
    offersAreLoading: boolean;
    refetch: () => void;
}
export const useUserOffers: UseUserOffers = () => {
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
        queryKey: ['userOffers', chainId, account],
        meta: { errCode: REACT_QUERY_ERRORS.FETCH_OFFERS },
        enabled: !!chainId && !!account && !!properties && !!prices && !!wlProperties,
        queryFn: async (): Promise<Offer[]> => {
            if (!chainId || !account || !properties || !prices || !wlProperties)
                return OFFER_LOADING;

            // Use RPC for user's own offers (much fewer requests)
            const userOffers = await fetchUserOffersRpc(
                account,
                chainId,
                properties,
                wlProperties,
                prices
            );

            return userOffers;
        },
    });

    const offersAreLoading = loading || propertiesAreLoading || pricesAreLoading || wlPropertiesAreLoading;

    return { 
        offers: isSuccess ? offers : [], 
        offersAreLoading, 
        refetch 
    };
}