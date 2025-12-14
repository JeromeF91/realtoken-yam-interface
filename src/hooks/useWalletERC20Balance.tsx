import { Web3Provider } from "@ethersproject/providers";
import { useWeb3React } from "@web3-react/core";
import BigNumber from "bignumber.js";
import { FC, useEffect, useState } from "react";
import { Erc20, Erc20ABI } from "src/abis";
import { getContract } from "src/utils";
import { WalletERC20Balance } from "src/components/WalletBalance/WalletERC20Balance";
import { useQuery } from "react-query";

interface TokenInfos{
    balance: BigNumber;
    symbol: string;
    decimals: string;
}

interface UseWalletERC20Balance{
    bigNumberbalance: BigNumber|undefined
    balance: string|undefined
    WalletERC20Balance: any
}

export const useWalletERC20Balance = (
    tokenAddress: string|undefined,
) : UseWalletERC20Balance => {

    const [bigNumberbalance,setBigNumberbalance] = useState<BigNumber|undefined>(undefined);
    const [balance,setBalance] = useState<string|undefined>(undefined);
    const [tokenSymbol,setTokenSymbol] = useState<string|undefined>(undefined);
    const { account, provider } = useWeb3React();

    const contract = getContract<Erc20>(
        tokenAddress ?? "",
        Erc20ABI,
        provider as Web3Provider,
        account,
    )

    const getTokenInfos = async (): Promise<TokenInfos> => {
        return new Promise<TokenInfos>(async (resolove,reject) => {
            try{

                if(!contract || !account) {
                    reject(new Error('Contract or account not available'));
                    return;
                }
    
                // Use callStatic for read-only calls and handle errors gracefully
                let balance: BigNumber = new BigNumber(0);
                let decimals: BigNumber = new BigNumber(18); // Default to 18 decimals
                let tokenSymbol: string = '';
                
                try {
                    const balanceBN = await contract.callStatic.balanceOf(account);
                    balance = new BigNumber(balanceBN.toString());
                } catch (err: any) {
                    console.warn(`Failed to get balanceOf for token ${tokenAddress}:`, err?.message);
                    // If balanceOf fails, assume balance is 0
                    balance = new BigNumber(0);
                }
                
                try {
                    const decimalsBN = await contract.callStatic.decimals();
                    decimals = new BigNumber(decimalsBN.toString());
                } catch (err: any) {
                    console.warn(`Failed to get decimals for token ${tokenAddress}:`, err?.message);
                    // Default to 18 decimals if call fails
                    decimals = new BigNumber(18);
                }
                
                try {
                    tokenSymbol = await contract.callStatic.symbol();
                } catch (err: any) {
                    console.warn(`Failed to get symbol for token ${tokenAddress}:`, err?.message);
                    // Use address short form as fallback symbol
                    tokenSymbol = tokenAddress ? `${tokenAddress.slice(0, 6).toUpperCase()}` : '';
                }
    
                resolove({
                    balance: balance,
                    symbol: tokenSymbol,
                    decimals: decimals.toString()
                })
                
            }catch(err){
                console.log("Failed to get wallet balance: ", err);
                // Return fallback values instead of rejecting
                resolove({
                    balance: new BigNumber(0),
                    symbol: tokenAddress ? `${tokenAddress.slice(0, 6).toUpperCase()}` : '',
                    decimals: '18'
                });
            }
        })
    }

    const { data, refetch } = useQuery([tokenAddress], getTokenInfos, { enabled: (!!provider && !!tokenAddress && !!account)});

    useEffect(() => {
        if(tokenAddress){
            setBigNumberbalance(undefined);
            setTokenSymbol(undefined);
            setBalance(undefined);
            refetch();
        }
    },[tokenAddress])

    useEffect(() => {
        if(data){
            setBigNumberbalance(data.balance);
            setTokenSymbol(data.symbol);
            setBalance(data.balance.shiftedBy(-data.decimals).toFixed(10).toString());
        }
    },[data])

    const Component: FC = (): React.ReactElement => <WalletERC20Balance balance={balance} symbol={tokenSymbol}/>

    return{
        WalletERC20Balance: Component,
        bigNumberbalance: bigNumberbalance,
        balance: balance
    }
}