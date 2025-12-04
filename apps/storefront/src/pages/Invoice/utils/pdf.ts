// ===============================
// Force PDF Preview Always
// ===============================

import { invoiceDownloadPDF } from '@/shared/service/b2b';
import b2bLogger from '@/utils/b3Logger';

/**
 * Replace Order ID inside PDF — but only when Epicor order exists.
 */
const replaceOrderIdInPdf = async (
  pdfBlob: Blob,
  oldOrderId: string,
  newOrderId: string | null,
): Promise<Blob> => {
  if (!newOrderId || !oldOrderId || newOrderId === oldOrderId) {
    return pdfBlob;
  }

  try {
    const pdfLibModule = await import('pdf-lib');
    const { PDFDocument, rgb, StandardFonts } = pdfLibModule;

    const pdfBytes = await pdfBlob.arrayBuffer();
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const pages = pdfDoc.getPages();
    const firstPage = pages[0];

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const replacementText = `Order ID: ${newOrderId}`;

    const textX = 482;
    const textY = 710;

    firstPage.drawRectangle({
      x: textX - 10,
      y: textY - 4,
      width: 200,
      height: 16,
      color: rgb(1, 1, 1),
    });

    firstPage.drawText(replacementText, {
      x: textX,
      y: textY,
      size: 10,
      font,
      color: rgb(0, 0, 0),
    });

    const modifiedPdfBytes = await pdfDoc.save();
    // @ts-expect-error - pdf-lib returns Uint8Array which is compatible with Blob but TypeScript types are strict
    return new Blob([modifiedPdfBytes], { type: 'application/pdf' });

  } catch (error) {
    b2bLogger.error('PDF modification failed:', error);
    return pdfBlob;
  }
};

/**
 * Always produce a BLOB URL
 * Ensures PDF viewer always works
 * If Epicor ID not found, returns original PDF with BigCommerce order ID
 */
const analyzePDFUrl = async (
  url: string,
  orderNumber?: string,
  epicorOrderNumber?: string | null,
): Promise<string> => {
  try {
    // Handle blob URLs - if already a blob URL, return it directly
    if (url.startsWith('blob:')) {
      return url;
    }

    // Fetch the PDF
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
    }

    const originalBlob = await response.blob();

    // Validate that we have a valid PDF blob
    if (!originalBlob || originalBlob.size === 0) {
      throw new Error('Invalid PDF blob received');
    }

    // Case 1: No Epicor ID found → return original BLOB URL (contains BigCommerce order ID)
    // This is the key case - when Epicor ID is not available, we show BigCommerce ID
    // Check explicitly for null, undefined, or empty string
    if (epicorOrderNumber === null || epicorOrderNumber === undefined || epicorOrderNumber === '') {
      // Ensure blob has correct MIME type
      const pdfBlob = originalBlob.type === 'application/pdf' 
        ? originalBlob 
        : new Blob([originalBlob], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(pdfBlob);
      return blobUrl;
    }

    // Case 2: No orderNumber provided → return original (shouldn't happen but safety check)
    if (!orderNumber) {
      const blobUrl = URL.createObjectURL(originalBlob);
      return blobUrl;
    }

    // Case 3: Same order number → no modification needed, return original
    if (epicorOrderNumber === orderNumber) {
      const blobUrl = URL.createObjectURL(originalBlob);
      return blobUrl;
    }

    // Case 4: Epicor found & different → Replace BigCommerce ID with Epicor ID
    try {
      const modifiedBlob = await replaceOrderIdInPdf(originalBlob, orderNumber, epicorOrderNumber);
      const blobUrl = URL.createObjectURL(modifiedBlob);
      return blobUrl;
    } catch (replaceError) {
      b2bLogger.error('Error replacing order ID in PDF, using original with BigCommerce ID:', replaceError);
      // If replacement fails, return original PDF (shows BigCommerce order ID)
      const blobUrl = URL.createObjectURL(originalBlob);
      return blobUrl;
    }

  } catch (error) {
    b2bLogger.error('Error processing PDF:', error);
    // Try to fetch and create blob URL as fallback
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Fallback fetch failed: ${response.status}`);
        }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      return blobUrl;
    } catch (fallbackError) {
      b2bLogger.error('Fallback PDF fetch also failed:', fallbackError);
      // Last resort: return original URL (might not work for preview but better than nothing)
      return url;
    }
  }
};


/**
 * Unified PDF download URL generator
 */
export const getInvoiceDownloadPDFUrl = async (
  invoiceId: string,
  isPayNow = false,
  orderNumber?: string,
  epicorOrderNumber?: string | null,
): Promise<string> => {
  const {
    invoicePdf: { url }
  } = await invoiceDownloadPDF(Number(invoiceId), isPayNow);

  return analyzePDFUrl(url, orderNumber, epicorOrderNumber);
};


/**
 * Used for View / Print
 */
export const handlePrintPDF = async (
  invoiceId: string,
  isPayNow = false,
  orderNumber?: string,
  epicorOrderNumber?: string | null,
): Promise<string> => {
  const { invoicePdf: { url } } = await invoiceDownloadPDF(Number(invoiceId), isPayNow);

    return analyzePDFUrl(url, orderNumber, epicorOrderNumber);
};
