import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email || !email.includes('@')) {
      return Response.json({ error: 'Invalid email' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_ANON_KEY || ''
    );

    const { error } = await supabase.from('waitlist').insert({ email });

    if (error?.code === '23505') {
      return Response.json({ message: 'Already on the waitlist!' });
    }
    if (error) {
      console.error('[Waitlist]', error.message);
      return Response.json({ error: 'Failed to join' }, { status: 500 });
    }

    return Response.json({ message: 'You\'re on the list!' });
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
