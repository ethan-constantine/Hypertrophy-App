const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Accounts that never need to pay (the owner). Add more with the FREE_ACCESS_EMAILS env var (comma-separated).
const FREE_EMAILS = ['eluwaji@live.co.uk']
  .concat((process.env.FREE_ACCESS_EMAILS || '').split(','))
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

async function hasPaid(email) {
  const tried = new Set();
  for (const e of [email, email.toLowerCase()]) {
    if (tried.has(e)) continue;
    tried.add(e);
    const sessions = await stripe.checkout.sessions.list({ limit: 50, customer_details: { email: e } });
    const paid = sessions.data.some(
      s => s.status === 'complete' && (s.payment_status === 'paid' || s.payment_status === 'no_payment_required')
    );
    if (paid) return true;
  }
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    const user = data && data.user;
    if (error || !user || !user.email) {
      res.status(401).json({ error: 'Not signed in' });
      return;
    }

    const email = user.email;
    let access = FREE_EMAILS.includes(email.toLowerCase());
    if (!access) access = await hasPaid(email);

    if (access) {
      // Keep the has_access flag in step (best effort - the Stripe check above is what decides)
      const { error: upsertErr } = await supabase
        .from('app_state')
        .upsert({ user_id: user.id, has_access: true }, { onConflict: 'user_id' });
      if (upsertErr) console.error('Could not set has_access flag:', upsertErr.message);
    }

    res.status(200).json({ access });
  } catch (err) {
    console.error('Access check failed:', err.message);
    res.status(500).json({ error: 'Could not check access' });
  }
};
