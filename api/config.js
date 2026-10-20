import { ENV, send } from './_lib/util.js';

// Öffentliche Einstellungen für die Webseite. Der anon-Schlüssel von Supabase ist absichtlich öffentlich
// (die Datenbank schützt sich über Zeilenregeln), alle anderen Schlüssel bleiben auf dem Server.
export default function handler(req, res) {
  send(res, 200, {
    supabaseUrl: ENV.SUPABASE_URL,
    supabaseAnonKey: ENV.SUPABASE_ANON_KEY,
    features: {
      twelveData: !!ENV.TWELVEDATA_API_KEY,
      fmp: !!ENV.FMP_API_KEY,
      search: !!ENV.PARALLEL_API_KEY,
      ai: !!ENV.ANTHROPIC_API_KEY,
    },
    aiDailyLimit: ENV.AI_DAILY_LIMIT,
  });
}
