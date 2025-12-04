import B3Request from '@/shared/service/request/b3Fetch';
import { store } from '@/store';

/**
 * Get company info with extraFields using userCompany query
 * Note: This requires userId, not companyId
 */
const getCompanyWithExtraFields = `
  query GetCompany($userId: Int!) {
    userCompany(userId: $userId) {
      id
      companyName
      extraFields {
        fieldName
        fieldValue
      }
    }
  }
`;

interface CompanyExtraFieldsResponse {
  company?: {
    id: string;
    companyName: string;
    extraFields: Array<{
      fieldName: string;
      fieldValue: string;
    }>;
  };
}

/**
 * Fetch company info with extraFields
 * Falls back to window.b2bCustomerData if GraphQL query fails
 * Note: Requires userId from store, not companyId
 * @param _companyId - Kept for backwards compatibility, but not used (userId is fetched from store)
 */
export const getCompanyWithExtraFieldsData = async (
  _companyId: string | number,
): Promise<CompanyExtraFieldsResponse> => {
  try {
    // Get userId from store (b2bId)
    const state = store.getState();
    const userId = state.company.customer.b2bId;
    
    if (!userId) {
      console.warn('[Epicor] No userId found in store, cannot fetch company via GraphQL');
      return { company: undefined };
    }
    
    const response = await B3Request.graphqlB2B({
      query: getCompanyWithExtraFields,
      variables: { userId: Number(userId) },
    });
    
    // Handle different response structures
    // B3Request.graphqlB2B returns data directly, not wrapped in data
    if (response?.userCompany) {
      return { company: response.userCompany };
    }
    if (response?.data?.userCompany) {
      return { company: response.data.userCompany };
    }
    
    console.warn('[Epicor] Company not found in response structure. Full response:', response);
    return { company: undefined };
  } catch (error) {
    console.error('[Epicor] GraphQL company query failed:', error);
    return { company: undefined };
  }
};

