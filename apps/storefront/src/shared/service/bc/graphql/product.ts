import B3Request from '@/shared/service/request/b3Fetch';

const PRODUCT_CUSTOM_FIELDS_QUERY = `
  query ProductCustomFields($productId: Int!) {
    site {
      product(entityId: $productId) {
        customFields {
          edges {
            node {
              name
              value
            }
          }
        }
      }
    }
  }
`;

interface ProductCustomFieldsResponse {
  data?: {
    site?: {
      product?: {
        customFields?: {
          edges?: Array<{
            node: {
              name: string;
              value: string;
            };
          }>;
        };
      };
    };
  };
  site?: {
    product?: {
      customFields?: {
        edges?: Array<{
          node: {
            name: string;
            value: string;
          };
        }>;
      };
    };
  };
}

export interface ProductCustomField {
  name: string;
  value: string;
}

/**
 * Fetch product custom fields from BigCommerce storefront GraphQL API.
 */
export const getProductCustomFields = async (
  productId: number,
): Promise<ProductCustomField[]> => {
  try {
    const response = await B3Request.graphqlBC<ProductCustomFieldsResponse>({
      query: PRODUCT_CUSTOM_FIELDS_QUERY,
      variables: { productId },
    });

    // graphqlBC returns the entire GraphQL payload (with or without data wrapper depending on env)
    const edges =
      response?.data?.site?.product?.customFields?.edges ||
      response?.site?.product?.customFields?.edges ||
      [];

    return edges.map((edge) => edge.node);
  } catch (error) {
    console.error('[ProductCustomFields] Failed to fetch custom fields', error);
    return [];
  }
};

