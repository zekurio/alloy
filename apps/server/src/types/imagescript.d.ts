declare module "@matmen/imagescript" {
  export class Image {
    bitmap: Uint8ClampedArray

    constructor(width: number, height: number)

    get width(): number
    get height(): number

    static rgbToColor(r: number, g: number, b: number): number
    static decode(data: Uint8Array): Promise<Image>

    fill(color: number): this
    cover(width: number, height: number): this
    crop(x: number, y: number, width: number, height: number): this
    composite(source: Image, x?: number, y?: number): this
    rotate(angle: number, resize?: boolean): this
    encodeJPEG(quality?: number): Promise<Uint8Array>
  }
}
