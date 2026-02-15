-- Purpose Framework RAG schema setup
-- Run this in Supabase SQL Editor for the target project.

create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  doc_id text not null,
  chunk_id text not null,
  version integer not null,
  content text not null,
  embedding vector(1536) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists document_chunks_org_doc_chunk_version_uq
  on public.document_chunks (org_id, doc_id, chunk_id, version);

create index if not exists document_chunks_org_doc_idx
  on public.document_chunks (org_id, doc_id, version);

create index if not exists document_chunks_embedding_ivfflat_idx
  on public.document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create or replace function public.match_chunks(
  query_embedding vector(1536),
  match_count integer,
  org_id_input text
)
returns table (
  id text,
  content text,
  doc_id text,
  chunk_id text,
  version integer,
  similarity double precision
)
language sql
stable
as $$
  select
    dc.id::text,
    dc.content,
    dc.doc_id::text,
    dc.chunk_id::text,
    dc.version::integer,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where dc.org_id = org_id_input
  order by dc.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;
