export interface OrderIntegrationInfo {
  BigCommerceOrderId: string;
  OrderCreationTime: string;
  EpicorErpOrderNumber: string;
  EpicorOrderStatus: string;
}

import { WEBHOOK_CONFIG, getWebhookUrl } from '@/constants';

export interface N8nEpicorResponse {
  success: boolean;
  EpicorErpOrderNumber?: string;
  data?: Array<{
    namespace: string;
    key: string;
    value: string;
  }>;
}

/**
 * Fetches Epicor Order ID from n8n endpoint (same as order confirmation page)
 * @param orderId - The BigCommerce order ID
 * @returns Promise with EpicorErpOrderNumber or null if not found
 */
export const getBigCommerceOrderMetaFields = async (
  orderId: string | number,
): Promise<OrderIntegrationInfo | null> => {
  if (!orderId) {
    return null;
  }

  try {
    // Call n8n endpoint with order ID (same as order confirmation page)
    const n8nUrl = `${getWebhookUrl(WEBHOOK_CONFIG.ENDPOINTS.GET_ORDER_EPICOR_ID)}?orderId=${orderId}`;

    const response = await fetch(n8nUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data: N8nEpicorResponse = await response.json();

      // Handle n8n response format: { "success": true, "EpicorErpOrderNumber": "491655" }
      if (data.success === true && data.EpicorErpOrderNumber) {
        const epicorId = data.EpicorErpOrderNumber.toString();
        return {
          BigCommerceOrderId: orderId.toString(),
          OrderCreationTime: '',
          EpicorErpOrderNumber: epicorId,
          EpicorOrderStatus: '',
        };
      }

      // Fallback: Check if EpicorErpOrderNumber exists directly
      if (data.EpicorErpOrderNumber) {
        const epicorId = data.EpicorErpOrderNumber.toString();
        return {
          BigCommerceOrderId: orderId.toString(),
          OrderCreationTime: '',
          EpicorErpOrderNumber: epicorId,
          EpicorOrderStatus: '',
        };
      }

      // Fallback: Handle full metafields response if n8n returns it
      if (data.data && Array.isArray(data.data)) {
        const integrationField = data.data.find(
          (field) => field.namespace === 'Sales Department' && field.key === 'order_integration_info',
        );

        if (integrationField && integrationField.value) {
          try {
            const integrationData: OrderIntegrationInfo = JSON.parse(integrationField.value);
            if (integrationData.EpicorErpOrderNumber) {
              return integrationData;
            }
          } catch (parseError) {
            console.error('Error parsing metafield value:', parseError);
          }
        }
      }

      // Check if success is false
      if (data.success === false) {
        return null;
      }
    }
  } catch (error) {
    console.error('Error fetching Epicor Order ID from n8n endpoint:', error);
    return null;
  }

  return null;
};
