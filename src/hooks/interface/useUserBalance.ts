import { useWeb3React } from "@web3-react/core";
import { useQuery } from "react-query";
import { REACT_QUERY_ERRORS } from "../../types/ReactQueryErrors";
import { UserBalances } from "../../types/UserBalance";
import { fetchUserBalancesRpc } from "../../utils/rpc/fetchUserBalancesRpc";
import { useProperties } from "./useProperties";

type UseUserBalance = (enabled?: boolean) => {
    userBalancesAreLoading: boolean;
    userBalances: UserBalances;
}
export const useUserBalance: UseUserBalance = (enabled = true) => {

    const { chainId, account } = useWeb3React();
    const { properties } = useProperties();

    const { isLoading: userBalancesAreLoading, data: userBalances, isSuccess } = useQuery({
        queryKey: ['userBalances', chainId, account, properties?.length],
        meta: { errCode: REACT_QUERY_ERRORS.FETCH_USER_BALANCES },
        enabled: enabled && !!chainId && !!account && !!properties && properties.length > 0,
        queryFn: async (): Promise<UserBalances> => {
            if(!chainId || !account || !properties) return {};
            
            // Get token addresses from properties
            const tokenAddresses = properties.map(prop => prop.contractAddress);
            
            // Fetch balances via RPC
            const balances = await fetchUserBalancesRpc(account, chainId, tokenAddresses);
            console.log('USER BALANCES: ', balances);

            return balances;
        }
    })

    return {
        userBalancesAreLoading,
        userBalances: isSuccess ? userBalances : {}
    }

}