export interface ISnippetVariable {
  name: string;
  type: 'text' | 'number' | 'table';
  default?: string;
  description?: string;
}

export interface ISqlSnippet {
  id: string;
  name: string;
  description?: string;
  sql: string;
  category: string;
  variables: ISnippetVariable[];
  createdAt: string;
  lastUsedAt?: string;
  useCount: number;
}

export interface ISnippetExport {
  $schema: 'drift-snippets/v1';
  snippets: ISqlSnippet[];
}
