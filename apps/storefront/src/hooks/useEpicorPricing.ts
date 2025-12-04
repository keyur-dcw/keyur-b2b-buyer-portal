import { useEffect, useState } from 'react';

import { getEpicorPrice, getCompanyExtraFields } from '@/shared/service/b2b/epicorPricing';
import { getCompanyWithExtraFieldsData } from '@/shared/service/b2b/graphql/company';
import { useAppSelector } from '@/store';

interface UseEpicorPricingProps {
  productId: number | string;
  sku: string;
  quantity: number;
  enabled?: boolean;
}

interface UseEpicorPricingResult {
  epicorPrice: number | null;
  isLoading: boolean;
  error: string | null;
  currency: string;
}

/**
 * Hook to fetch Epicor pricing for a product
 * Gets company extraFields (CustID and Epicor GroupCode) and fetches price from N8N
 */
export function useEpicorPricing({
  productId,
  sku,
  quantity,
  enabled = true,
}: UseEpicorPricingProps): UseEpicorPricingResult {
  const [epicorPrice, setEpicorPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>('USD');
  const [companyExtraFields, setCompanyExtraFields] = useState<{
    custId: string | null;
    epicorGroupCode: string | null;
  } | null>(null);

  // Get company info from Redux store
  const companyId = useAppSelector(({ company }) => company.companyInfo.id);
  const isB2BUser = useAppSelector(({ company }) => company.customer.role) !== 2;

  // Fetch company extraFields once
  useEffect(() => {
    if (!enabled || !isB2BUser || !companyId) {
      return;
    }

    const fetchCompanyExtraFields = async () => {
      try {
        // Try to get from window first (set by main Epicor script)
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
        } else {
          console.warn('[Epicor Pricing] No extraFields found in response');
        }
      } catch (err) {
        console.error('[Epicor Pricing] Error fetching company extraFields:', err);
      }
    };

    fetchCompanyExtraFields();
  }, [enabled, isB2BUser, companyId]);

  // Fetch Epicor price when company extraFields are available
  useEffect(() => {
    if (!enabled || !isB2BUser || !productId) {
      setEpicorPrice(null);
      return;
    }

    // If companyExtraFields is null or doesn't have required values, don't fetch
    if (!companyExtraFields) {
      setEpicorPrice(null);
      return;
    }

    const { custId, epicorGroupCode } = companyExtraFields;

    // Pass null if values are not available (not static values)
    // Always make the request, but pass null if values are not available
    const fetchPrice = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const pricingResponse = await getEpicorPrice({
          customer_id: custId || null, // Dynamic from company extraFields, null if not available
          customer_group_code: epicorGroupCode || null, // Dynamic from company extraFields, null if not available
          ship_to_num: '',
          product_id: productId,
          sku: sku || '',
          quantity: quantity || 1,
        });

        if (pricingResponse) {
          // Check if response is successful and valid
          if (pricingResponse.success && pricingResponse.pricing?.valid && pricingResponse.pricing?.netPrice !== undefined) {
            const netPrice = pricingResponse.pricing.netPrice;
            const responseCurrency = pricingResponse.pricing.currency || 'USD';
            
            setEpicorPrice(netPrice);
            setCurrency(responseCurrency);
            setError(null);
          } else {
            // Response received but not valid
            const errorMsg = pricingResponse.pricing?.error || 'Price not available or invalid';
            console.warn('[Epicor Pricing] Price not valid:', {
              success: pricingResponse.success,
              valid: pricingResponse.pricing?.valid,
              error: pricingResponse.pricing?.error,
            });
            setEpicorPrice(null);
            setError(errorMsg);
          }
        } else {
          // No response received
          console.warn('[Epicor Pricing] No pricing response received');
          setEpicorPrice(null);
          setError('No pricing response received');
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to fetch price';
        console.error('[Epicor Pricing] Error in fetchPrice:', err);
        setError(errorMessage);
        setEpicorPrice(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPrice();
  }, [enabled, isB2BUser, productId, sku, quantity, companyExtraFields]);

  return {
    epicorPrice,
    isLoading,
    error,
    currency,
  };
}

