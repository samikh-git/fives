declare module "*.sql?raw" {
  const content: string;
  export default content;
}

declare module "*.ttf" {
  const content: ArrayBuffer;
  export default content;
}

declare module "satori/yoga.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

