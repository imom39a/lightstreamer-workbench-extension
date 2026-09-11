export type MissingMarkdownLink = Readonly<{
  document: string;
  line: number;
  target: string;
}>;

export declare function findMissingMarkdownLinks(
  rootDirectory: string,
  documents: readonly string[]
): Promise<readonly MissingMarkdownLink[]>;
