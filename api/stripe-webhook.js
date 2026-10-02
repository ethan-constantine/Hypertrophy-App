const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // req.body must be the raw buffer, not parsed JSON, for signature verification
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details && session.customer_details.email;

    if (!email) {
      console.error('No email on completed checkout session', session.id);
      res.status(200).json({ received: true, warning: 'no email on session' });
      return;
    }

    try {
      // Find the Supabase auth user by email
      const { data: usersPage, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      if (listErr) throw listErr;

      const matchedUser = usersPage.users.find(
        u => u.email && u.email.toLowerCase() === email.toLowerCase()
      );

      if (!matchedUser) {
        // No account yet under this email — record the paid email so we can grant access when they sign up
        await supabase.from('pending_access').upsert({ email: email.toLowerCase() });
        res.status(200).json({ received: true, note: 'no matching user yet, recorded as pending' });
        return;
      }

      // Mark their row as having access, creating the row if it doesn't exist yet
      const { error: upsertErr } = await supabase
        .from('app_state')
        .upsert({ user_id: matchedUser.id, has_access: true }, { onConflict: 'user_id' });

      if (upsertErr) throw upsertErr;

      res.status(200).json({ received: true });
    } catch (err) {
      console.error('Error granting access:', err.message);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(200).json({ received: true });
};

module.exports.config = {
  api: {
    bodyParser: false, // Stripe needs the raw body to verify the signature
  },
};
