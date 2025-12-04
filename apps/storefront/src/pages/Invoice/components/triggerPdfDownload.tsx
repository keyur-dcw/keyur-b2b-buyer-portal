export function triggerPdfDownload(url: string, fileName: string) {
  // Handle blob URLs - ensure they work properly for downloads
  if (url.startsWith('blob:')) {
    // For blob URLs, create a temporary link and trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Clean up after a short delay
    setTimeout(() => {
      document.body.removeChild(a);
      // Note: We don't revoke the blob URL here as it might still be in use
      // The browser will handle cleanup when the download completes
    }, 100);
  } else {
    // For regular URLs, use standard download
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.download = fileName;
  a.click();
  }
}
