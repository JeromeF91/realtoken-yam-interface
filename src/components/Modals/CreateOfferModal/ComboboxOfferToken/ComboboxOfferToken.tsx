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

  const { userBalancesAreLoading } = useUserBalance();

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
          {!userBalancesAreLoading ? (
            <Text size='sm' c={'gray'}>
              {balance.toString(10)}
            </Text>
          ) : (
            <Skeleton width={200} height={15} />
          )}
        </Flex>
        {userBalancesAreLoading ? <Loader size={18} /> : undefined}
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


  const {
    userBalances: realTokenUserBalances,
    userBalancesAreLoading: realTokenUserBalancesAreLoading,
  } = useUserBalance();

  const [assetsBalances, setAssetsBalances] = useState<any>({});
  const [assetsBalancesAreLoading, setAssetsBalancesAreLoading] =
    useState<boolean>(false);
  const [hasFetchedBalances, setHasFetchedBalances] = useState<boolean>(false);
  
  const fetchBalances = async () => {
    // Don't fetch if already fetched or if no data
    if (hasFetchedBalances || !data || data.length === 0) {
      return;
    }
    
    try {
      setAssetsBalancesAreLoading(true);

      const assetsBalance = await Promise.all(
        data.map(async (item) => {
          if (!provider || !account || !item.value) return {};
          try {
            const contract = getContract<Erc20>(
              item.value ?? '',
              Erc20ABI,
              provider,
              account
            );
            if (!contract) return {};
            // Use callStatic for read-only calls
            const decimals = new BigNumber(
              (await contract.callStatic.decimals()).toString()
            );
            const balance = new BigNumber(
              (await contract.callStatic.balanceOf(account)).toString()
            ).shiftedBy(-decimals.toNumber());
            return { [item.value.toLowerCase()]: balance };
          } catch (err) {
            // Silently handle errors for individual tokens
            return {};
          }
        })
      );

      const assets: { [addr: string]: BigNumber } = {};
      assetsBalance.forEach((item) => {
        Object.keys(item).forEach((key) => {
          assets[key] = item[key];
        });
      });

      setAssetsBalances(assets);
      setHasFetchedBalances(true);
      setAssetsBalancesAreLoading(false);
    } catch (err) {
      console.error(err);
      setAssetsBalancesAreLoading(false);
    }
  };
  
  // Only fetch balances when dropdown is opened, not on mount
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
    onDropdownOpen: () => {
      // Fetch balances when dropdown opens (lazy loading)
      if (type === 'others' && !hasFetchedBalances) {
        fetchBalances();
      }
    },
  });

  const [userBalances, userBalancesAreLoading] = useMemo(() => {
    if (type == 'realtoken') {
      return [realTokenUserBalances, realTokenUserBalancesAreLoading];
    } else {
      return [assetsBalances, assetsBalancesAreLoading];
    }
  }, [
    realTokenUserBalances,
    realTokenUserBalances,
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
