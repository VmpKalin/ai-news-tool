import type { Embedder } from '../ingestion/embedder.js';

export const CLUSTER_PROFILE_TEXT = `
I am curating a news digest for Ukrainian IT professionals in Germany.
Ich kuratiere einen News-Digest für ukrainische IT-Fachkräfte in Deutschland.

I am interested ONLY in / Ich interessiere mich NUR für:
- German IT industry news, Deutsche IT-Branche, Technologieunternehmen
- Berlin/Munich/NRW tech scene, Startup-Szene, Tech-Standorte Deutschland
- European tech startups and investments, Europäische Tech-Investitionen
- Germany digitalization, Digitalisierung, E-Government, digitale Infrastruktur
- Software engineering trends, Softwareentwicklung, Developer Tools
- EU tech regulation, DSGVO, GDPR updates, AI Act, KI-Verordnung
- Ukrainian IT companies in Germany/EU, ukrainische IT-Unternehmen
- Remote work, Fachkräfteeinwanderung, Relocation, Blue Card, Aufenthaltstitel

I am NOT interested in / Ich bin NICHT interessiert an:
- Job postings, Stellenangebote, Stellenanzeigen, vacancies, hiring
- "we are hiring", "wir suchen", "join our team", "Verstärkung gesucht"
- Recruitment, Personalvermittlung, HR announcements
- Non-tech German news: Politik, Sport, Kriminalität, politics, sports, crime
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
