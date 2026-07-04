/** Fetches an image and either opens the native share sheet (mobile) or triggers a download (desktop). */
export async function shareOrDownloadImage(url: string, filename: string, shareText: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load the image to share.");
  const blob = await response.blob();
  const file = new File([blob], filename, { type: blob.type });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename, text: shareText });
      return;
    } catch {
      // user cancelled the share sheet — fall through to download
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
