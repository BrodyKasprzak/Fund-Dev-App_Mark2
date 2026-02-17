export type RagChunk = {
  id: string;
  docId: string;
  chunkId: string;
  version: number;
  content: string;
  similarity: number;
  headingPath: string | null;
};

export type RagCitation = {
  docId: string;
  docTitle: string;
  headingPath: string | null;
  chunkId: string | null;
  snippet: string;
  moreContext: string | null;
  deepLink: string;
  similarity: number;
};

export type RagAnswerResponse = {
  answer: string;
  citations: RagCitation[];
  supportLabel: string;
  contextSummary: string | null;
};

export type RagRetrieveResponse = {
  chunks: RagChunk[];
};
