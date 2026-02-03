declare module 'pdf-text-extract' {
  interface ExtractOptions {
    splitPages?: boolean;
  }

  function extract(
    filePath: string,
    options: ExtractOptions,
    callback: (err: Error | null, pages: string | string[]) => void
  ): void;

  export = extract;
}
