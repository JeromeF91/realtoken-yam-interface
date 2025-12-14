import { Skeleton, Text } from "@mantine/core";
import { Offer, OFFER_TYPE } from "src/types/offer";
import classes from './OfferDeltaTable.module.css';

interface OfferDeltaTableProps{
    offer: Offer, 
    officialPrice: number|undefined,
    officialYield: number|undefined,
    offerPrice: number|undefined,
    offerYield: number|undefined,
}
export const OfferDeltaTable = ({ offer, officialPrice, officialYield, offerPrice, offerYield }: OfferDeltaTableProps) => {

    // Always show Offer column if we have offerPrice or offerYield
    const showOfferColumn = offerPrice !== undefined || offerYield !== undefined;
    
    return(
        <table className={classes.table}>
            <thead className={classes.tableHead}>
                <tr>
                    <th className={classes.tableCell}></th>
                    <th className={classes.tableCell}>Original</th>
                    { showOfferColumn ? <th className={classes.tableCell}>Offer</th> : undefined }
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td className={classes.tableCell}>Yield</td>
                    <td className={classes.tableCell}>
                        { officialYield !== undefined ? `${officialYield.toFixed(2)}%` : <Skeleton height={15}/> }
                    </td>
                    { showOfferColumn ? 
                        <td className={classes.tableCell}>
                            { offerYield !== undefined ? <Text>{`${offerYield.toFixed(2)}%`}</Text> : <Skeleton height={15}/> }
                        </td> 
                        : 
                        undefined 
                    }
                </tr>
                <tr>
                    <td className={classes.tableCell}>Price</td>
                    <td className={classes.tableCell}>
                        { officialPrice !== undefined ? `${officialPrice.toFixed(2)}` : <Skeleton height={15}/> }
                    </td>
                    { showOfferColumn ? 
                        <td className={classes.tableCell}>
                            { offerPrice !== undefined ? 
                                `${offerPrice.toFixed(2)}` 
                                : 
                                <Skeleton height={15}/>
                            }
                        </td> 
                        :
                        undefined 
                    }
                </tr>
            </tbody>
        </table>
    )
}