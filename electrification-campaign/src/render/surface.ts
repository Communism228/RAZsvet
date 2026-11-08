
export interface Surface {
  readonly ctx: CanvasRenderingContext2D;
  readonly input: HTMLCanvasElement;
  readonly name: string;
  resize(width: number,height: number): void;
  present(): void;
  destroy(): void;
}
export type SurfaceFactory=(parent: HTMLElement)=>Promise<Surface>;
