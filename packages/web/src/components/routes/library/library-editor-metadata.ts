import type { GameRow, UserSearchResult } from "@alloy/api"

export type LibraryMetadataDraft = {
  title: string
  setTitle: (value: string) => void
  description: string
  setDescription: (value: string) => void
  game: GameRow | null
  setGame: (value: GameRow | null) => void
  mentions: UserSearchResult[]
  setMentions: (value: UserSearchResult[]) => void
  tags: string[]
  setTags: (value: string[]) => void
}

export function clipMetadataEditorFields(draft: LibraryMetadataDraft) {
  return {
    title: draft.title,
    onTitleChange: draft.setTitle,
    description: draft.description,
    onDescriptionChange: draft.setDescription,
    game: draft.game,
    onGameChange: draft.setGame,
    mentions: draft.mentions,
    onMentionsChange: draft.setMentions,
    tags: draft.tags,
    onTagsChange: draft.setTags,
  }
}
