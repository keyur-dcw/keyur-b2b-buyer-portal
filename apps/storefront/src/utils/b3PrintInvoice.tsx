import { getBigCommerceOrderMetaFields } from '@/shared/service/b2b/graphql/bigcommerceOrderMeta';
import b2bLogger from './b3Logger';

const bindDom = (html: string, domId: string) => {
  let iframeDom = document.getElementById(domId) as HTMLIFrameElement | null;
  if (!iframeDom) {
    iframeDom = document.createElement('iframe');
    iframeDom.src = 'about:blank';
    iframeDom.id = domId;
    iframeDom.style.display = 'none';
    document.body.appendChild(iframeDom);
  }
  const iframeDoc = iframeDom.contentWindow?.document;
  if (iframeDoc) {
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();
  }
  iframeDom.style.display = 'block';
};

/**
 * Replace BigCommerce order ID with Epicor order number in invoice HTML
 */
const replaceOrderIdInHtml = (html: string, bigcommerceOrderId: string, epicorOrderNumber: string | null): string => {
  if (!epicorOrderNumber) {
    return html;
  }

  let modifiedHtml = html;

  // Replace order ID in various formats:
  // 1. "Order #1869" or "Order # 1869"
  // 2. "for Order #1869"
  // 3. "Order:" followed by "#1869" or "1869"
  // 4. Any standalone "#1869" or "1869" in the context of order information

  const patterns = [
    // Pattern: "Order #1869" or "Order # 1869"
    new RegExp(`Order\\s*#\\s*${bigcommerceOrderId}`, 'gi'),
    // Pattern: "for Order #1869"
    new RegExp(`for\\s+Order\\s*#\\s*${bigcommerceOrderId}`, 'gi'),
    // Pattern: "Order: #1869" or "Order: 1869"
    new RegExp(`Order:\\s*#?\\s*${bigcommerceOrderId}`, 'gi'),
    // Pattern: standalone "#1869" in invoice context
    new RegExp(`#${bigcommerceOrderId}(?!\\d)`, 'g'),
  ];

  patterns.forEach((pattern) => {
    modifiedHtml = modifiedHtml.replace(pattern, (match) => {
      // Replace the order ID part with Epicor number, keeping the format
      if (match.includes('#')) {
        return match.replace(bigcommerceOrderId, epicorOrderNumber);
      }
      return match.replace(bigcommerceOrderId, epicorOrderNumber);
    });
  });

  // Also replace in the title/header if present
  modifiedHtml = modifiedHtml.replace(
    new RegExp(`Invoice for Order #${bigcommerceOrderId}`, 'gi'),
    `Invoice for Order #${epicorOrderNumber}`,
  );

  return modifiedHtml;
};

const b2bPrintInvoice = async (orderId: string, domId: string) => {
  try {
    // Fetch Epicor order number first
    let epicorOrderNumber: string | null = null;
    try {
      const integrationInfo = await getBigCommerceOrderMetaFields(orderId);
      epicorOrderNumber = integrationInfo?.EpicorErpOrderNumber || null;
    } catch (error) {
      b2bLogger.error('Error fetching Epicor order number for invoice:', error);
      // Continue with original order ID if Epicor fetch fails
    }

    // Fetch invoice HTML
    const response = await fetch(`/account.php?action=print_invoice&order_id=${orderId}`);
    if (!response.ok) {
      throw new Error('Network response was not ok.');
    }

    let html = await response.text();

    // Replace BigCommerce order ID with Epicor order number in the HTML
    if (epicorOrderNumber) {
      html = replaceOrderIdInHtml(html, orderId, epicorOrderNumber);
    }

    // Display the modified HTML
    bindDom(html, domId);
  } catch (error) {
    b2bLogger.error('Error Invoice:', error);
  }
};

export default b2bPrintInvoice;
