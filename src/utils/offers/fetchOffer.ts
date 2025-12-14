import { Web3Provider } from '@ethersproject/providers';
import { PropertiesToken } from '@realtoken/realt-commons';
import { Offer } from '../../types/offer';
import { fetchOfferRpc } from '../rpc/fetchOfferRpc';
import { Price } from '../../types/price';

/**
 * Fetch a single offer using RPC calls instead of TheGraph
 */
export const fetchOffer = (
  provider: Web3Provider, 
  account: string, 
  chainId: number, 
  offerId: number, 
  propertiesToken: PropertiesToken[],
  wlProperties: number[],
  prices: Price
): Promise<Offer|undefined> => {
    return new Promise(async (resolve, reject) => {
      try {
        const offer = await fetchOfferRpc(
          provider,
          account,
          chainId,
          offerId,
          propertiesToken,
          wlProperties,
          prices
        );
        
        if (offer) {
          resolve(offer);
        } else {
          reject(new Error('Offer not found'));
        }
      } catch (error) {
        console.error('Error fetching offer:', error);
        reject(error);
      }
    });
};
