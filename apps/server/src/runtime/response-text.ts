import { logger } from "@workspace/logging"

export async function responseTextOrEmpty(
  response: Response,
  operation: string,
): Promise<string> {
  try {
    return await response.text()
  } catch (err) {
    logger.warn(`[response] failed to read ${operation} body:`, err)
    return ""
  }
}
