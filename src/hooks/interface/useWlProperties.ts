import { useQuery } from "react-query";
import { REACT_QUERY_ERRORS } from "../../types/ReactQueryErrors";
import { CHAINS, ChainsID } from "../../constants";
import { useWeb3React } from "@web3-react/core";
import { apiClient } from "../../utils/offers/getClientURL";
import { gql } from "@apollo/client";

type UseWlProperties = () => {
    wlPropertiesAreLoading: boolean;
    wlProperties: number[] | undefined;
}
export const useWlProperties: UseWlProperties = () => {
    
    const { chainId, account } = useWeb3React();

    const { isLoading: wlPropertiesAreLoading, data: wlProperties, isSuccess } = useQuery({
        queryKey: ['wlProperties', chainId, account],
        meta: { errCode: REACT_QUERY_ERRORS.FETCH_WL_PROPERTIES },
        enabled: !!chainId && !!account,
        queryFn: async (): Promise<number[]> => {
            if(!chainId || !account) return [];

            const prefix = CHAINS[chainId as ChainsID].graphPrefixes.realtoken;
        
            try {
                const { data, errors } = await apiClient.query({
                query: gql`
                    query getWlProperties{
                    ${prefix}{
                        account(id: "${account.toLowerCase()}") {
                        userIds{
                            userId
                            attributeKeys
                            trustedIntermediary{
                            address 
                            weight
                            }
                        }
                        }
                    }
                    }
                `,
                errorPolicy: 'all', // Return both data and errors
                });
        
                console.log('useWlProperties GraphQL response:', {
                    prefix,
                    account: account?.toLowerCase(),
                    data,
                    errors,
                    accountData: data[prefix]?.account,
                });
        
                const userIds = data[prefix]?.account?.userIds;
        
                let wlTokenIds: string[] | undefined = undefined;
                if(userIds && userIds.length > 0){
                    wlTokenIds = userIds[0].attributeKeys;
                }

                const result = wlTokenIds ? wlTokenIds.map(str => parseInt(str)) : [];
                console.log('useWlProperties parsed result:', {
                    userIds,
                    wlTokenIds,
                    result,
                });
                
                // If account is null, it might mean the account hasn't interacted with the contract
                // or the subgraph doesn't have data. Return empty array but log a warning.
                if (data[prefix]?.account === null) {
                    console.warn('Account not found in TheGraph subgraph. This might mean:', {
                        account: account?.toLowerCase(),
                        chainId,
                        message: 'Account may not have interacted with the contract, or subgraph is not synced',
                    });
                }
                
                return result;
            } catch (error) {
                console.error('Error fetching whitelisted properties:', error);
                return [];
            }

        }
    });

    return {
        wlPropertiesAreLoading,
        wlProperties
    }
}