import { Web3Provider } from "@ethersproject/providers";
import { useWeb3React } from "@web3-react/core";
import BigNumber from "bignumber.js";
import { useEffect, useState } from "react";
import { useQuery } from "react-query";
import { Erc20, Erc20ABI } from "src/abis";
import { getContract } from "src/utils";

interface ERC20TokensInfos{
    decimals: string;
    symbol: string;
    name: string;
}

export type UseERC20TokenInfo = (
    tokenAddress: string
) => {
    address: string|undefined;
    decimals: string|undefined;
    symbol: string|undefined;
    name: string|undefined;
}

export const useERC20TokenInfo: UseERC20TokenInfo = (tokenAddress) => {

    const [uuid,] = useState<number>(Math.random()*1000);
    const [tokenInfos,setTokenInfos] = useState<ERC20TokensInfos|undefined>(undefined);
    const { account, provider } = useWeb3React();

    const contract = getContract<Erc20>(
        tokenAddress,
        Erc20ABI,
        provider as Web3Provider,
        account,
    )

    const getTokenInfos = async (): Promise<ERC20TokensInfos> => {
        return new Promise<ERC20TokensInfos>(async (resolove,reject) => {
            try{

                if(!contract || !account) {
                    reject(new Error('Contract or account not available'));
                    return;
                }
    
                // Use callStatic for read-only calls and handle errors gracefully
                let name: string = '';
                let symbol: string = '';
                let decimals: string = '18'; // Default to 18 decimals
                
                try {
                    name = await contract.callStatic.name();
                } catch (err: any) {
                    console.warn(`Failed to get name for token ${tokenAddress}:`, err?.message);
                    // Use address as fallback name
                    name = `Token ${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
                }
                
                try {
                    symbol = await contract.callStatic.symbol();
                } catch (err: any) {
                    console.warn(`Failed to get symbol for token ${tokenAddress}:`, err?.message);
                    // Use address short form as fallback symbol
                    symbol = tokenAddress.slice(0, 6).toUpperCase();
                }
                
                try {
                    const decimalsBN = await contract.callStatic.decimals();
                    decimals = new BigNumber(decimalsBN.toString()).toString();
                } catch (err: any) {
                    console.warn(`Failed to get decimals for token ${tokenAddress}:`, err?.message);
                    // Default to 18 decimals if call fails
                    decimals = '18';
                }

                const res = {
                    name,
                    symbol,
                    decimals
                }    
                resolove(res)
                
            }catch(err){
                console.log("Failed to get ERC20 token infos: ", err);
                // Return fallback values instead of rejecting
                resolove({
                    name: `Token ${tokenAddress ? tokenAddress.slice(0, 6) + '...' + tokenAddress.slice(-4) : 'Unknown'}`,
                    symbol: tokenAddress ? tokenAddress.slice(0, 6).toUpperCase() : 'UNK',
                    decimals: '18'
                });
            }
        })
    }

    const { data, refetch } = useQuery([`erc20TokenInfos-${uuid}`],getTokenInfos, { enabled: (!!provider && !!tokenAddress && !!account)});

    useEffect(() => {
        if(tokenAddress){
            setTokenInfos(undefined);
            refetch();
        }
    },[tokenAddress])

    useEffect(() => {
        if(data) setTokenInfos(data);
    },[data])

    return{
        address: tokenAddress ? tokenAddress : undefined,
        decimals: tokenInfos ? tokenInfos.decimals : undefined,
        symbol: tokenInfos ? tokenInfos.symbol : undefined,
        name: tokenInfos ? tokenInfos.name : undefined
    }
}