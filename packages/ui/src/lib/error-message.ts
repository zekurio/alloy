import { t } from "@alloy/contracts/schema"

const MessageSchema = t.string()
const MessageObjectSchema = t.looseObject({ message: t.string() })

export function messageFromUnknown(cause: unknown): string | null {
  const directMessage = MessageSchema.safeParse(cause)
  if (directMessage.success) {
    const message = directMessage.data.trim()
    return message.length > 0 ? message : null
  }

  if (cause instanceof Error) {
    const message = cause.message.trim()
    return message.length > 0 ? message : null
  }

  const messageObject = MessageObjectSchema.safeParse(cause)
  if (messageObject.success) {
    const message = messageObject.data.message.trim()
    return message.length > 0 ? message : null
  }

  return null
}
