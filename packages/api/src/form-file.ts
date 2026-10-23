/** Multipart endpoints take a File; name a bare Blob before sending it. */
export function blobAsFile(blob: Blob, name: string): File {
  return blob instanceof File
    ? blob
    : new File([blob], name, { type: blob.type })
}
