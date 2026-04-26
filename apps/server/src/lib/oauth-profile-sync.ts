type OAuthProfileSyncResult = {
  image: string | null
  synced: boolean
}

export async function syncLinkedOAuthImage(
  _userId: string
): Promise<OAuthProfileSyncResult> {
  return { image: null, synced: false }
}
