export interface Cache {
  setIfAbsent(key: string, ttlSec: number): Promise<boolean>
}
