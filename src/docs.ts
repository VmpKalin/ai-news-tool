export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'News Digest Bot API',
    version: '0.1.0',
    description:
      'Daily news digest daemon. Fetches articles from Inoreader, ranks them against a user profile via Voyage embeddings, and summarizes the top items with Claude in Ukrainian.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local dev' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Required only if TRIGGER_TOKEN env var is set on the server.',
      },
    },
    schemas: {
      RunRecord: {
        type: 'object',
        properties: {
          startedAt: { type: 'string', format: 'date-time' },
          finishedAt: { type: 'string', format: 'date-time' },
          durationMs: { type: 'integer' },
          success: { type: 'boolean' },
          error: { type: 'string', nullable: true },
        },
        required: ['startedAt', 'finishedAt', 'durationMs', 'success'],
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          isRunning: { type: 'boolean' },
          lastRun: { $ref: '#/components/schemas/RunRecord', nullable: true },
          nextRun: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['status', 'isRunning', 'lastRun', 'nextRun'],
      },
      RunResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          digest: { type: 'string', description: 'Ukrainian-language digest (8–10 bullets).' },
        },
        required: ['status', 'digest'],
      },
      LatestResponse: {
        type: 'object',
        properties: {
          digest: { type: 'string' },
          lastRun: { $ref: '#/components/schemas/RunRecord' },
        },
        required: ['digest', 'lastRun'],
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          message: { type: 'string', nullable: true },
        },
        required: ['error'],
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check and scheduler state',
        description:
          'Returns current running status, last run record, and next scheduled run time.',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
        },
      },
    },
    '/digest/run': {
      post: {
        summary: 'Manually trigger the pipeline',
        description:
          'Runs the full pipeline once (fetch → embed → search → summarize). Blocks until completion. Returns 409 if a run is already in progress.',
        security: [{ bearerAuth: [] }],
        responses: {
          '202': {
            description: 'Pipeline executed successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RunResponse' },
              },
            },
          },
          '401': {
            description: 'Missing or invalid bearer token (when TRIGGER_TOKEN is set)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '409': {
            description: 'Pipeline already running',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '500': {
            description: 'Pipeline failed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/digest/latest': {
      get: {
        summary: 'Fetch the most recently generated digest',
        description: 'Returns the digest from the last successful run (in-memory, lost on restart).',
        responses: {
          '200': {
            description: 'Last digest available',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LatestResponse' },
              },
            },
          },
          '404': {
            description: 'No digest has been generated yet',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const docsHtml = `<!doctype html>
<html>
  <head>
    <title>News Digest Bot API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>
`;
