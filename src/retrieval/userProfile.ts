import type { Embedder } from '../ingestion/embedder.js';

export const USER_PROFILE_TEXT = `
Interested in: artificial intelligence, machine learning, software engineering,
web development, TypeScript, cloud infrastructure, AWS, DevOps,
cybersecurity, European tech industry, IT startups
`;

export async function getUserProfileEmbedding(embedder: Embedder): Promise<number[]> {
  try {
    console.log('[UserProfile] Building profile embedding');
    return await embedder.embedQuery(USER_PROFILE_TEXT);
  } catch (cause) {
    console.error('[UserProfile] Failed to embed user profile', cause);
    throw new Error('Failed to build user profile embedding');
  }
}
