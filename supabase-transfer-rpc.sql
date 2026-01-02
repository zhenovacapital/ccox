-- Atomic transfer RPC: transfer_ccox
-- Run this in Supabase SQL editor (SQL Editor) to create the RPC

CREATE OR REPLACE FUNCTION public.transfer_ccox(
  p_sender UUID,
  p_recipient UUID,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sender_balance NUMERIC;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  SELECT cco_x_balance INTO v_sender_balance FROM public.users WHERE id = p_sender FOR UPDATE;
  IF v_sender_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sender not found');
  END IF;
  IF v_sender_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient funds');
  END IF;

  -- Perform updates inside same transaction
  UPDATE public.users
  SET cco_x_balance = cco_x_balance - p_amount,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_sender;

  UPDATE public.users
  SET cco_x_balance = cco_x_balance + p_amount,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_recipient;

  INSERT INTO public.transactions (sender_id, recipient_id, amount, currency, type)
  VALUES (p_sender, p_recipient, p_amount, 'CCOX', 'transfer');

  RETURN jsonb_build_object('success', true, 'message', 'Transfer completed');

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Allow authenticated role to execute the function
GRANT EXECUTE ON FUNCTION public.transfer_ccox(UUID, UUID, NUMERIC) TO authenticated;
