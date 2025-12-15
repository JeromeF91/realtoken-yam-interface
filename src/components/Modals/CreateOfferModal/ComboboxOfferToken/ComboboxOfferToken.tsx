import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Combobox,
  ComboboxItem,
  Flex,
  Input,
  InputBase,
  Loader,
  Skeleton,
  Text,
  useCombobox,
} from '@mantine/core';
import { getContract } from '@realtoken/realt-commons';
import { IconCheck } from '@tabler/icons';
import { useWeb3React } from '@web3-react/core';

import BigNumber from 'bignumber.js';

import { Erc20, Erc20ABI } from '../../../../abis';
import { useUserBalance } from '../../../../hooks/interface/useUserBalance';
import classes from './ComboboxOfferToken.module.css';

export type DataWithBalance = ComboboxItem & {
  balance: BigNumber;
  selected: boolean;
};

const ComboboxOfferTokenOption = ({ item }: { item: DataWithBalance }) => {
  const { value, balance, label, selected } = item;

  // Don't fetch balances here - they're passed from parent
  const userBalancesAreLoading = false;

  // Only show balance if this is the selected token (for 'others' type, balances are only fetched for selected token)
  const showBalance = selected && balance && !balance.isZero();

  return (
    <Combobox.Option value={value}>
      <Flex justify={'space-between'} align={'center'}>
        <Flex justify={'space-between'} w={'100%'} pl={4}>
          <Flex gap={4} align={'center'}>
            {selected ? <IconCheck size={16} /> : undefined}
            <Text size='sm' c={'brand'} fw={500}>
              {label}
            </Text>
          </Flex>
          {showBalance && !userBalancesAreLoading ? (
            <Text size='sm' c={'gray'}>
              {balance.toString(10)}
            </Text>
          ) : selected && userBalancesAreLoading ? (
            <Skeleton width={200} height={15} />
          ) : undefined}
        </Flex>
        {selected && userBalancesAreLoading ? <Loader size={18} /> : undefined}
      </Flex>
    </Combobox.Option>
  );
};

export const ComboboxOfferToken = ({
  data,
  label,
  value,
  placeholder,
  disabled,
  onChange,
  type,
  required,
}: {
  data: ComboboxItem[];
  label: string;
  value?: any;
  placeholder: string;
  disabled: boolean;
  onChange: any;
  type: 'realtoken' | 'others';
  required?: boolean;
}) => {
  const { provider, account } = useWeb3React();

  const [searchTerm, setSearchTerm] = useState('');

  const { t } = useTranslation('modals', { keyPrefix: 'sell' });


  // Only fetch real token balances when a token is selected or dropdown is opened
  const [shouldFetchRealTokenBalances, setShouldFetchRealTokenBalances] = useState<boolean>(false);
  
  const {
    userBalances: realTokenUserBalances,
    userBalancesAreLoading: realTokenUserBalancesAreLoading,
  } = useUserBalance(shouldFetchRealTokenBalances);

  const [assetsBalances, setAssetsBalances] = useState<any>({});
  const [assetsBalancesAreLoading, setAssetsBalancesAreLoading] =
    useState<boolean>(false);
  
  // Fetch balance for a single selected token only (for 'others' type)
  const fetchTokenBalance = async (tokenAddress: string) => {
    if (!provider || !account || !tokenAddress || type !== 'others') {
      return;
    }
    
    const tokenKey = tokenAddress.toLowerCase();
    
    try {
      setAssetsBalancesAreLoading(true);

      const contract = getContract<Erc20>(
        tokenAddress,
        Erc20ABI,
        provider,
        account
      );
      
      if (!contract) {
        setAssetsBalancesAreLoading(false);
        return;
      }
      
      // Use callStatic for read-only calls
      const decimals = new BigNumber(
        (await contract.callStatic.decimals()).toString()
      );
      const balance = new BigNumber(
        (await contract.callStatic.balanceOf(account)).toString()
      ).shiftedBy(-decimals.toNumber());
      
      setAssetsBalances((prev: any) => {
        // Only update if not already cached (avoid overwriting with same value)
        if (prev[tokenKey]) {
          return prev;
        }
        return {
          ...prev,
          [tokenKey]: balance,
        };
      });
      
      setAssetsBalancesAreLoading(false);
    } catch (err) {
      console.error(`Error fetching balance for token ${tokenAddress}:`, err);
      setAssetsBalancesAreLoading(false);
    }
  };
  
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
    onDropdownOpen: () => {
      // Enable real token balance fetching when dropdown opens (lazy loading)
      if (type === 'realtoken' && !shouldFetchRealTokenBalances) {
        setShouldFetchRealTokenBalances(true);
      }
    },
  });
  
  // Fetch balance when a token is selected
  useEffect(() => {
    if (value && provider && account) {
      if (type === 'others') {
        const tokenKey = value.toLowerCase();
        // Only fetch if not already cached
        if (!assetsBalances[tokenKey]) {
          fetchTokenBalance(value);
        }
      } else if (type === 'realtoken') {
        // Enable real token balance fetching when a token is selected
        if (!shouldFetchRealTokenBalances) {
          setShouldFetchRealTokenBalances(true);
        }
      }
    }
  }, [value, type, provider, account]);

  const [userBalances, userBalancesAreLoading] = useMemo(() => {
    if (type == 'realtoken') {
      return [realTokenUserBalances, realTokenUserBalancesAreLoading];
    } else {
      return [assetsBalances, assetsBalancesAreLoading];
    }
  }, [
    realTokenUserBalances,
    realTokenUserBalancesAreLoading,
    type,
    assetsBalances,
    assetsBalancesAreLoading,
  ]);

  const dataWithAmounts: DataWithBalance[] = useMemo(
    () =>
      data.map((item) => {
        const balance =
          userBalances[item.value.toLowerCase()] || new BigNumber(0);
        return {
          ...item,
          balance,
          selected: item.value.toLowerCase() === value?.toLowerCase(),
        };
      }),
    [userBalances, userBalancesAreLoading, data, value]
  );

  const sortedDatas = useMemo(
    () =>
      dataWithAmounts.sort((a, b) => {
        return b.balance.comparedTo(a.balance);
      }),
    [dataWithAmounts]
  );

  const shouldFilterOptions = sortedDatas.every(
    (item) => item.label !== searchTerm
  );
  const filteredOptions = shouldFilterOptions
    ? sortedDatas.filter((item) =>
        item.label.toLowerCase().includes(searchTerm.toLowerCase().trim())
      )
    : sortedDatas;

  const options = filteredOptions.map((item) => (
    <ComboboxOfferTokenOption item={item} key={item.value} />
  ));

  const selectedOption = sortedDatas.find((item) => item.value === value);

  return (
    <Combobox
      store={combobox}
      withinPortal={false}
      offset={0}
      onOptionSubmit={(val) => {
        onChange(val);
        combobox.closeDropdown();
        setSearchTerm('');
        // Fetch balance for the selected token
        if (type === 'others' && val) {
          fetchTokenBalance(val);
        }
      }}
      disabled={disabled}
    >
      <Combobox.Target>
        <InputBase
          label={label}
          component='button'
          type='button'
          pointer={false}
          rightSection={
            userBalancesAreLoading ? <Loader size={18} /> : <Combobox.Chevron />
          }
          rightSectionPointerEvents='none'
          classNames={{ root: classes.root, input: classes.input }}
          onClick={() => combobox.openDropdown()}
          onFocus={() => combobox.openDropdown()}
          placeholder={placeholder}
          required={required ?? false}
        >
          {selectedOption?.label || (
            <Input.Placeholder>{placeholder}</Input.Placeholder>
          )}
        </InputBase>
      </Combobox.Target>

      <Combobox.Dropdown className={classes.dropdown}>
        <Combobox.Search
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.currentTarget.value)}
          placeholder={t('searchTokens')}
        />
        <Combobox.Options mah={200} style={{ overflowY: 'auto' }}>
          {userBalancesAreLoading ? (
            <Combobox.Empty>Loading....</Combobox.Empty>
          ) : (
            options
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
};
