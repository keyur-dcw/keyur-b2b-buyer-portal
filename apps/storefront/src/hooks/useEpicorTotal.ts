import { useEffect, useState } from 'react';

import { getEpicorPrice } from '@/shared/service/b2b/epicorPricing';
import { getCompanyWithExtraFieldsData } from '@/shared/service/b2b/graphql/company';
import { getCompanyExtraFields } from '@/shared/service/b2b/epicorPricing';
import { useAppSelector } from '@/store';
import { getBCPrice } from '@/utils/b3Product/b3Product';

interface ProductItem {
  productId: number;
  variantSku: string;
  quantity: number;
  basePrice: number | string;
  taxPrice?: number | string;
}

interface UseEpicorTotalProps {
  products: ProductItem[];
  enabled?: boolean;
}

/**
 * Hook to calculate total price using Epicor prices when available
 * Falls back to BigCommerce prices for non-B2B users or when Epicor prices are not available
 */
export function useEpicorTotal({ products, enabled = true }: UseEpicorTotalProps) {
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [currency, setCurrency] = useState<string>('USD');
  const [companyExtraFields, setCompanyExtraFields] = useState<{
    custId: string | null;
    epicorGroupCode: string | null;
  } | null>(null);

  const companyId = useAppSelector(({ company }) => company.companyInfo.id);
  const isB2BUser = useAppSelector(({ company }) => company.customer.role) !== 2;
  const showInclusiveTaxPrice = useAppSelector(({ global }) => global.showInclusiveTaxPrice);

  // Fetch company extraFields once
  useEffect(() => {
    if (!enabled || !isB2BUser || !companyId) {
      setCompanyExtraFields(null);
      return;
    }

    const fetchCompanyExtraFields = async () => {
      try {
        // Try to get from window first
        if ((window as any).b2bCustomerData) {
          const b2bData = (window as any).b2bCustomerData;
          setCompanyExtraFields({
            custId: b2bData.customer_id,
            epicorGroupCode: b2bData.customer_group_code,
          });
          return;
        }

        // Fetch from GraphQL
        const response = await getCompanyWithExtraFieldsData(companyId);
        if (response?.company?.extraFields) {
          const extraFields = getCompanyExtraFields(response.company.extraFields);
          setCompanyExtraFields(extraFields);
        }
      } catch (err) {
        console.error('[Epicor Total] Error fetching company extraFields:', err);
      }
    };

    fetchCompanyExtraFields();
  }, [enabled, isB2BUser, companyId]);

  // Calculate total when products or companyExtraFields change
  useEffect(() => {
    if (!products || products.length === 0) {
      setTotal(0);
      return;
    }

    const calculateTotal = async () => {
      setIsLoading(true);

      try {
        let calculatedTotal = 0;
        let hasEpicorPrices = false;

        // If B2B user and we have company extraFields, try to get Epicor prices
        if (isB2BUser && companyExtraFields && companyExtraFields.custId && companyExtraFields.epicorGroupCode) {
          // Fetch Epicor prices for all products
          const pricePromises = products.map(async (product) => {
            try {
              const pricingResponse = await getEpicorPrice({
                customer_id: companyExtraFields.custId || null,
                customer_group_code: companyExtraFields.epicorGroupCode || null,
                ship_to_num: '',
                product_id: product.productId,
                sku: product.variantSku || '',
                quantity: Number(product.quantity) || 1,
              });

              if (pricingResponse?.success && pricingResponse.pricing?.valid && pricingResponse.pricing?.netPrice !== undefined) {
                hasEpicorPrices = true;
                if (pricingResponse.pricing.currency) {
                  setCurrency(pricingResponse.pricing.currency);
                }
                return pricingResponse.pricing.netPrice * Number(product.quantity);
              }
            } catch (err) {
              console.warn('[Epicor Total] Error fetching price for product:', product.productId, err);
            }
            return null;
          });

          const epicorPrices = await Promise.all(pricePromises);

          // Sum up Epicor prices
          epicorPrices.forEach((price) => {
            if (price !== null) {
              calculatedTotal += price;
            }
          });

          // If we got some Epicor prices but not all, fall back to BC prices for missing ones
          if (hasEpicorPrices) {
            products.forEach((product, index) => {
              if (epicorPrices[index] === null) {
                // Fall back to BigCommerce price
                const bcPrice = getBCPrice(
                  Number(product.basePrice),
                  Number(product.taxPrice || 0),
                );
                calculatedTotal += bcPrice * Number(product.quantity);
              }
            });
          } else {
            // No Epicor prices available, use BigCommerce prices
            hasEpicorPrices = false;
          }
        }

        // If no Epicor prices, use BigCommerce prices
        if (!hasEpicorPrices) {
          products.forEach((product) => {
            const bcPrice = getBCPrice(
              Number(product.basePrice),
              Number(product.taxPrice || 0),
            );
            calculatedTotal += bcPrice * Number(product.quantity);
          });
        }

        setTotal(calculatedTotal);
      } catch (err) {
        console.error('[Epicor Total] Error calculating total:', err);
        // Fall back to BigCommerce prices on error
        let fallbackTotal = 0;
        products.forEach((product) => {
          const bcPrice = getBCPrice(
            Number(product.basePrice),
            Number(product.taxPrice || 0),
          );
          fallbackTotal += bcPrice * Number(product.quantity);
        });
        setTotal(fallbackTotal);
      } finally {
        setIsLoading(false);
      }
    };

    calculateTotal();
  }, [products, isB2BUser, companyExtraFields, showInclusiveTaxPrice]);

  return { total, isLoading, currency };
}

