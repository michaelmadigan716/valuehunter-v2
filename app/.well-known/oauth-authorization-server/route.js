import { oauthMetadata } from '../../../lib/codexBetaOAuth.mjs';
export function GET() { return Response.json(oauthMetadata()); }
