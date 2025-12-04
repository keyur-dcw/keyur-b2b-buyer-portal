import { useEffect, useState } from 'react';

import { getEpicorPrice } from '@/shared/service/b2b/epicorPricing';
import { getCompanyWithExtraFieldsData } from '@/shared/service/b2b/graphql/company';
import { getCompanyExtraFields } from '@/shared/service/b2b/epicorPricing';
import { useAppSelector } from '@/store';
import { getBCPrice } from '@/utils/b3Product/b3Product';
import { getProductPriceIncTaxOrExTaxBySetting } from '@/utils/b3Price';
import { Variant } from '@/types/products';

interface CheckedProduct {
  node: {
    productId: number | string;
    variantId: number | string;
    variantSku?: string | null;
    sku?: string;
    quantity: number | string;
    basePrice?: number | string | null;
    taxPrice?: number | string;
    tax?: number | string | null;
    productsSearch?: {
      variants?: Array<{
        variant_id: number | string;
        [key: string]: any;
      }> | null;
      [key: string]: any;
    };
    [key: string]: any;
  };
}

interface UseEpicorSubtotalProps {
  checkedArr: CheckedProduct[];
  enabled?: boolean;
}

/**
 * Hook to calculate subtotal for selected products using Epicor prices when available
 * Falls back to BigCommerce prices for non-B2B users or when Epicor prices are not available
 */
export function useEpicorSubtotal({ checkedArr, enabled = true }: UseEpicorSubtotalProps) {
  const [subtotal, setSubtotal] = useState<number>(0);
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
        console.error('[Epicor Subtotal] Error fetching company extraFields:', err);
      }
    };

    fetchCompanyExtraFields();
  }, [enabled, isB2BUser, companyId]);

  // Calculate subtotal when checkedArr or companyExtraFields change
  useEffect(() => {
    if (!checkedArr || checkedArr.length === 0) {
      setSubtotal(0);
      setIsLoading(false);
      return;
    }

    const calculateSubtotal = async () => {
      setIsLoading(true);

      try {
        let calculatedSubtotal = 0;
        let hasEpicorPrices = false;

        // If B2B user and we have company extraFields, try to get Epicor prices
        if (isB2BUser && companyExtraFields && companyExtraFields.custId && companyExtraFields.epicorGroupCode) {
          // Fetch Epicor prices for all checked products
          const pricePromises = checkedArr.map(async (item) => {
            try {
              const { node } = item;
              const productId = node.productId;
              const sku = node.variantSku || node.sku || '';
              const quantity = Number(node.quantity) || 1;

              const pricingResponse = await getEpicorPrice({
                customer_id: companyExtraFields.custId || null,
                customer_group_code: companyExtraFields.epicorGroupCode || null,
                ship_to_num: '',
                product_id: productId,
                sku: sku,
                quantity: quantity,
              });

              if (pricingResponse?.success && pricingResponse.pricing?.valid && pricingResponse.pricing?.netPrice !== undefined) {
                hasEpicorPrices = true;
                if (pricingResponse.pricing.currency) {
                  setCurrency(pricingResponse.pricing.currency);
                }
                return pricingResponse.pricing.netPrice * quantity;
              }
            } catch (err) {
              console.warn('[Epicor Subtotal] Error fetching price for product:', item.node.productId, err);
            }
            return null;
          });

          const epicorPrices = await Promise.all(pricePromises);

          // Sum up Epicor prices
          epicorPrices.forEach((price, index) => {
            if (price !== null) {
              calculatedSubtotal += price;
            } else {
              // Fall back to BigCommerce price for this product
              const item = checkedArr[index];
              const { node } = item;
              let bcPrice = 0;

              // Try to get price from variants if available
              if (node.productsSearch?.variants?.length && node.variantId) {
                const priceIncTax = getProductPriceIncTaxOrExTaxBySetting(
                  node.productsSearch.variants as Variant[],
                  Number(node.variantId),
                );
                bcPrice = priceIncTax || Number(node.basePrice || 0);
              } else {
                // Use basePrice and taxPrice
                const taxPrice = Number(node.taxPrice || node.tax || 0);
                bcPrice = getBCPrice(Number(node.basePrice || 0), taxPrice);
              }

              calculatedSubtotal += bcPrice * Number(node.quantity || 1);
            }
          });

          // If we got some Epicor prices, use the calculated subtotal
          if (hasEpicorPrices) {
            setSubtotal(calculatedSubtotal);
            setIsLoading(false);
            return;
          }
        }

        // If no Epicor prices, use BigCommerce prices
        checkedArr.forEach((item) => {
          const { node } = item;
          let bcPrice = 0;

          // Try to get price from variants if available
          if (node.productsSearch?.variants?.length && node.variantId) {
            const priceIncTax = getProductPriceIncTaxOrExTaxBySetting(
              node.productsSearch.variants as Variant[],
              Number(node.variantId),
            );
            bcPrice = priceIncTax || Number(node.basePrice || 0);
          } else {
            // Use basePrice and taxPrice
            const taxPrice = Number(node.taxPrice || node.tax || 0);
            bcPrice = getBCPrice(Number(node.basePrice || 0), taxPrice);
          }

          calculatedSubtotal += bcPrice * Number(node.quantity || 1);
        });

        setSubtotal(calculatedSubtotal);
      } catch (err) {
        console.error('[Epicor Subtotal] Error calculating subtotal:', err);
        // Fall back to BigCommerce prices on error
        let fallbackSubtotal = 0;
        checkedArr.forEach((item) => {
          const { node } = item;
          let bcPrice = 0;

          if (node.productsSearch?.variants?.length && node.variantId) {
            const priceIncTax = getProductPriceIncTaxOrExTaxBySetting(
              node.productsSearch.variants as Variant[],
              Number(node.variantId),
            );
            bcPrice = priceIncTax || Number(node.basePrice || 0);
          } else {
            const taxPrice = Number(node.taxPrice || node.tax || 0);
            bcPrice = getBCPrice(Number(node.basePrice || 0), taxPrice);
          }

          fallbackSubtotal += bcPrice * Number(node.quantity || 1);
        });
        setSubtotal(fallbackSubtotal);
      } finally {
        setIsLoading(false);
      }
    };

    calculateSubtotal();
  }, [checkedArr, isB2BUser, companyExtraFields, showInclusiveTaxPrice, enabled]);

  return { subtotal, isLoading, currency };
}

