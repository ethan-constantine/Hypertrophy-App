const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const sessionId = req.query.session_id;
  if (!sessionId) {
    res.status(400).json({ error: 'Missing session_id' });
    return;
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      res.status(200).json({ paid: false });
      return;
    }

    const email = session.customer_details && session.customer_details.email;
    res.status(200).json({ paid: true, email });
  } catch (err) {
    console.error('Failed to verify checkout session:', err.message);
    res.status(500).json({ error: 'Could not verify checkout session' });
  }
};
