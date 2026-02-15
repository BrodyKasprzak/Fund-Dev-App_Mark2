export type RagChunk = {
  id: string;
  docId: string;
  chunkId: string;
  version: number;
  content: string;
  similarity: number;
};

export type RagCitation = {
  docId: string;
  chunkId: string;
  snippet: string;
  similarity: number;
};

export type RagAnswerResponse = {
  answer: string;
  citations: RagCitation[];
};

export type RagRetrieveResponse = {
  chunks: RagChunk[];
};
