import type { Embedder } from '../ingestion/embedder.js';

export const USER_PROFILE_TEXT = `
I am a software engineer interested ONLY in:
- Artificial intelligence and machine learning (LLMs, agents, tools)
- Software engineering and developer tools
- TypeScript, Node.js, .NET, C#
- Cloud infrastructure: AWS, Docker, Kubernetes
- Cybersecurity and DevOps
- European and Ukrainian tech industry news
- Crypto technology (blockchain, protocols) — NOT prices or crime

I am NOT interested in:
- Crime, violence, accidents, disasters
- Politics and government (unless directly tech policy)
- Sports, entertainment, celebrities
- General world news, human interest stories
- Health, medicine (unless health tech)
- War coverage (unless Ukrainian tech sector impact)
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
