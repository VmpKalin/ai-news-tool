import type { Embedder } from '../ingestion/embedder.js';

export const CLUSTER_PROFILE_TEXT = `
I am curating a news digest for Ukrainian IT professionals in Germany.

I am interested ONLY in:
- German IT industry news, German tech companies, Berlin/Munich/NRW tech scene
- European tech startups and investments
- Germany digitalization, e-government, digital infrastructure
- Software engineering trends relevant to the German market
- EU tech regulation, GDPR updates, AI Act implementation
- Ukrainian IT companies working in Germany or EU
- Remote work and relocation to Germany for IT professionals

I am NOT interested in:
- Job postings, vacancies, hiring announcements, career opportunities
- "we are hiring", "join our team", "open positions", "job opening"
- Recruitment content, HR announcements
- Non-tech German news (politics, sports, crime)
- US-only tech news with no European relevance
`;

export async function getClusterProfileEmbedding(embedder: Embedder): Promise<number[]> {
  try {
    console.log('[ClusterProfile] Building profile embedding');
    return await embedder.embedQuery(CLUSTER_PROFILE_TEXT);
  } catch (cause) {
    console.error('[ClusterProfile] Failed to embed cluster profile', cause);
    throw new Error('Failed to build cluster profile embedding');
  }
}
