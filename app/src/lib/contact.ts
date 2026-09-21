/**
 * Phone and email normalisation for customer, supplier and installer contact
 * details.
 *
 * Phones store in E.164 (`+61…`) because that is the only form that works
 * everywhere it gets used: `tel:` and `sms:` links, a future SMS provider, and
 * the CES paperwork. "0448 100 294", "0448100294" and "+61 448 100 294" are
 * the same number, and storing whichever one was typed means they compare
 * unequal and de-duplicate badly.
 *
 * Normalise on BLUR, never per keystroke. Rewriting "04" to "+614" while
 * someone is still typing makes the field feel broken and loses the caret.
 */

/** Australian numbers, normalised to E.164. Returns null if it isn't one. */
export function normalisePhone(raw: string): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''

  // Keep a leading +, drop every other non-digit: spaces, brackets, dashes,
  // dots, and the (04) 8410 1234 style people paste out of email signatures.
  const plus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  // Already international.
  if (plus || digits.startsWith('61')) {
    const national = digits.startsWith('61') ? digits.slice(2) : digits
    // A +61 number is 9 digits after the country code. Some people include
    // the trunk 0 as well (+61 0448 …), which is wrong but common.
    const cleaned = national.startsWith('0') ? national.slice(1) : national
    if (cleaned.length !== 9) return null
    return `+61${cleaned}`
  }

  // National format: 0 + 9 digits. Mobiles are 04…, landlines 02/03/07/08.
  if (digits.length === 10 && digits.startsWith('0')) {
    return `+61${digits.slice(1)}`
  }

  // 9 digits with the trunk 0 already dropped — "448 100 294".
  if (digits.length === 9 && /^[2-9]/.test(digits)) {
    return `+61${digits}`
  }

  return null
}

/** Spaced for reading: +61 448 100 294. Storage stays E.164. */
export function formatPhone(e164: string): string {
  const m = /^\+61(\d{3})(\d{3})(\d{3})$/.exec(e164 ?? '')
  return m ? `+61 ${m[1]} ${m[2]} ${m[3]}` : (e164 ?? '')
}

export interface FieldCheck {
  /** The value to store — normalised when valid, the raw input when not. */
  value: string
  error: string | null
}

export function checkPhone(raw: string): FieldCheck {
  const normalised = normalisePhone(raw)
  if (normalised === null) {
    return {
      value: raw,
      error: 'Not an Australian number — expected 10 digits like 0448 100 294, or +61 448 100 294.',
    }
  }
  return { value: normalised, error: null }
}

/**
 * Deliberately permissive. The only email check that proves anything is
 * sending one; a strict regex rejects valid addresses (plus-addressing,
 * long TLDs, apostrophes) far more often than it catches a typo. This
 * catches the shapes that cannot be an address at all.
 */
export function checkEmail(raw: string): FieldCheck {
  const value = (raw ?? '').trim().toLowerCase()
  if (!value) return { value: '', error: null }
  const ok = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)
  return {
    value,
    error: ok ? null : 'Doesn’t look like an email address — expected name@example.com.',
  }
}

/** Both at once, for a form that saves them together. */
export function checkContact(
  phone: string, email: string,
): { phone: FieldCheck; email: FieldCheck; firstError: string | null } {
  const p = checkPhone(phone)
  const e = checkEmail(email)
  return { phone: p, email: e, firstError: p.error ?? e.error }
}
