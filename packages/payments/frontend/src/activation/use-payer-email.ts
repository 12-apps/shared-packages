'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The payer e-mail (FUT-4050): opens with the caller's value, takes the
 * endpoint's once it answers — unless the owner has already typed, because
 * overwriting what someone is typing is worse than a stale suggestion. Kept
 * across a refusal and a retry, like the card: the owner fixes one field.
 */
export function usePayerEmail(initial: string, suggested: string | null) {
  const [email, setTyped] = useState(initial);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const edited = useRef(false);

  // `initial` too: a host reading its session may only know it a render late.
  useEffect(() => {
    if (!edited.current) setTyped(suggested ?? initial);
  }, [suggested, initial]);

  const setEmail = useCallback((value: string) => {
    edited.current = true;
    setTyped(value);
  }, []);

  return { email, setEmail, emailError, setEmailError };
}
