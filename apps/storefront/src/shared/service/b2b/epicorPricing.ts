/**
 * Epicor Pricing Service
 * Fetches Epicor prices from N8N webhook
 */

interface EpicorPricingRequest {
  customer_id: string | null;
  customer_group_code: string | null;
  ship_to_num?: string;
  product_id: string | number;
  sku: string;
  quantity: number;
}

interface EpicorPricingResponse {
  success: boolean;
  pricing?: {
    success: boolean;
    netPrice: number;
    basePrice: number;
    currency: string;
    discount: number;
    valid: boolean;
    error: string | null;
  };
  product_sku?: string;
  product_code?: string;
  timestamp?: string;
}

const N8N_WEBHOOK_URL = 'https://cannon.n8n.asgard.dcw.dev/webhook/epicor-pricing';
const CACHE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// In-memory cache for pricing data
const priceCache = new Map<
  string,
  { response: EpicorPricingResponse; timestamp: number }
>();

/**
 * Get cache key for pricing request
 */
function getCacheKey(request: EpicorPricingRequest): string {
  const customerId = request.customer_id || 'null';
  const groupCode = request.customer_group_code || 'null';
  return `${customerId}-${groupCode}-${request.product_id}-${request.sku}-${request.quantity}`;
}

/**
 * Fetch Epicor price from N8N webhook
 * Passes null for customer_id and customer_group_code if not available (not static values)
 */
export async function getEpicorPrice(
  request: EpicorPricingRequest,
): Promise<EpicorPricingResponse | null> {
  try {
    // Generate cache key (always generate it, even if values are null)
    const cacheKey = getCacheKey(request);
    
    // Check cache first (only if we have valid customer_id and customer_group_code)
    if (request.customer_id && request.customer_group_code) {
      const cached = priceCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TIMEOUT) {
        return cached.response;
      }
    }

    // Make request to N8N webhook with dynamic values (not static)
    // Pass null if values are not available (as requested by user)
    const requestBody = {
      customer_id: request.customer_id || null, // Dynamic from company extraFields, null if not available
      customer_group_code: request.customer_group_code || null, // Dynamic from company extraFields, null if not available
      ship_to_num: request.ship_to_num || '',
      product_id: String(request.product_id),
      sku: request.sku || '',
      quantity: request.quantity,
    };
    
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`N8N webhook error: ${response.status}`);
    }

    const responseData = await response.json();

    // Handle array response (N8N might return an array)
    let data: EpicorPricingResponse;
    if (Array.isArray(responseData)) {
      // If response is an array, take the first element
      data = responseData[0] as EpicorPricingResponse;
    } else {
      data = responseData as EpicorPricingResponse;
    }

    // Validate response structure
    if (!data || typeof data !== 'object') {
      console.error('[Epicor Pricing] Invalid response structure:', data);
      return null;
    }

    // Cache the response (only if we have valid customer_id and customer_group_code)
    if (data && request.customer_id && request.customer_group_code) {
      priceCache.set(cacheKey, {
        response: data,
        timestamp: Date.now(),
      });
    }

    return data;
  } catch (error) {
    console.error('[Epicor Pricing] Error fetching price:', error);
    return null;
  }
}

/**
 * Get company extra fields (CustID and Epicor GroupCode)
 * This should be fetched from company info or GraphQL query
 */
export function getCompanyExtraFields(extraFields: Array<{ fieldName: string; fieldValue: string }> | undefined): {
  custId: string | null;
  epicorGroupCode: string | null;
} {
  if (!extraFields || !Array.isArray(extraFields)) {
    console.warn('[Epicor] No extraFields provided or not an array');
    return { custId: null, epicorGroupCode: null };
  }

  let custId: string | null = null;
  let epicorGroupCode: string | null = null;

  extraFields.forEach((field) => {
    // Check for CustID with various case combinations
    if (field.fieldName === 'CustID' || 
        field.fieldName === 'CustId' || 
        field.fieldName === 'custID' || 
        field.fieldName === 'custId' ||
        field.fieldName === 'CUSTID') {
      custId = field.fieldValue || null;
    }
    
    // Check for Epicor GroupCode with various case combinations
    if (field.fieldName === 'Epicor GroupCode' || 
        field.fieldName === 'EpicorGroupCode' || 
        field.fieldName === 'epicor groupcode' ||
        field.fieldName === 'Epicor groupcode' ||
        field.fieldName === 'EPICOR GROUPCODE') {
      epicorGroupCode = field.fieldValue || null;
    }
  });

  return { custId, epicorGroupCode };
}

/**
 * Clear pricing cache
 */
export function clearEpicorPriceCache(): void {
  priceCache.clear();
}

