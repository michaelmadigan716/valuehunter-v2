import { resourceMetadata } from '../../../lib/codexBetaOAuth.mjs';
export function GET() { return Response.json(resourceMetadata()); }
